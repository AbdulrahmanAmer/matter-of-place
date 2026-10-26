import "../fixtures/worker-env";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  addPhotos,
  readAccount,
  readCredits,
  readInvoices,
  readProperties,
  readReports,
  sendAccountLink,
  signOutAccount,
  verifyAccountLink,
} from "../../src/server/account/service";
import { enabledRoles } from "../../src/server/lib/actor";
import { env } from "../../src/server/lib/env";
import { AppError } from "../../src/server/lib/errors";
import { hashKey } from "../../src/server/lib/ids";
import { checkDb, checkMemory } from "../../src/server/lib/ratelimit";
import { getSessionUser, takeIssuedCookies } from "../../src/server/lib/session";
import { verifyTurnstile } from "../../src/server/lib/turnstile";
import { signUpload } from "../../src/server/submissions/service";
import { fakeDb, type FakeDbOptions } from "../fixtures/fake-db";

// W6 item 7, ruling H119: the client room's service. The room reads `account_room` with the verified session's user
// only; every address takes the same path before the answer, which is always `sent`, and a contact's address gets a
// `send_email` job after it; the link is spent by a same-origin post, never by a person on the team.

const auth = {
  verifyOtp: vi.fn(),
  signOut: vi.fn(),
};

vi.mock("../../src/server/lib/session", () => ({
  authClient: () => auth,
  getSessionUser: vi.fn(),
  takeIssuedCookies: vi.fn(),
}));
vi.mock("../../src/server/lib/actor", () => ({ enabledRoles: vi.fn() }));
vi.mock("../../src/server/lib/turnstile", () => ({ verifyTurnstile: vi.fn() }));
vi.mock("../../src/server/lib/ratelimit", () => ({ checkMemory: vi.fn(), checkDb: vi.fn() }));
vi.mock("../../src/server/submissions/service", () => ({ signUpload: vi.fn() }));

const USER = "00000000-0000-4000-8000-0000000000a1";
const REQUEST_ID = "00000000-0000-4000-8000-0000000000b1";
const SITE = "https://matterofplace.com";
const IP = "203.0.113.9";
const EMAIL = "owner@example.test";
const SALT = "unit-test-salt";
const input = { email: EMAIL, turnstile: "token" };

/** A same-origin post from `IP`; `waitUntil` collects what runs after the answer, as the Worker's does. */
function post(headers: Record<string, string> = { origin: SITE }) {
  const later: Promise<unknown>[] = [];
  const request = Object.assign(
    new Request(`${SITE}/_serverfn/account`, {
      method: "POST",
      headers: { "cf-connecting-ip": IP, ...headers },
    }),
    {
      waitUntil: (promise: Promise<unknown>) => {
        later.push(promise);
      },
    },
  );
  return { request, afterAnswer: () => Promise.all(later) };
}

const enqueued = (db: ReturnType<typeof fakeDb>) =>
  db.calls.filter((call) => call.name === "enqueue_job").map((call) => call.args[0]);

beforeEach(() => {
  vi.mocked(getSessionUser).mockReset();
  vi.mocked(takeIssuedCookies).mockReset().mockReturnValue([]);
  vi.mocked(enabledRoles).mockReset().mockResolvedValue([]);
  vi.mocked(verifyTurnstile).mockResolvedValue("pass");
  vi.mocked(checkMemory).mockReset().mockReturnValue({ ok: true });
  vi.mocked(checkDb).mockReset().mockResolvedValue({ ok: true });
  auth.verifyOtp.mockReset();
  auth.signOut.mockReset().mockResolvedValue({ error: null });
});

describe("readAccount", () => {
  it("shows the sign-in form without a session, and reads nothing", async () => {
    vi.mocked(getSessionUser).mockResolvedValue(null);
    const db = fakeDb();
    expect(await readAccount(db, post().request)).toEqual({ state: "signed-out" });
    expect(db.calls).toEqual([]);
  });

  it("reads the room of the session's own user", async () => {
    vi.mocked(getSessionUser).mockResolvedValue({ userId: USER, sessionId: "s", signedInAt: 0 });
    const request = {
      id: REQUEST_ID,
      address: "1 Test Way",
      city: "Berkeley",
      state: "California",
      workflow_state: "Under Review",
      received_at: "2026-10-01T10:00:00+00:00",
    };
    const db = fakeDb({
      rpc: { account_room: () => ({ name: "Test Owner", email: EMAIL, requests: [request] }) },
    });
    expect(await readAccount(db, post().request)).toEqual({
      state: "room",
      name: "Test Owner",
      email: EMAIL,
      requests: [request],
    });
    expect(db.calls).toEqual([{ kind: "rpc", name: "account_room", args: [{ p_user: USER }] }]);
  });

  it("says the account was not found when no contact is the session's", async () => {
    vi.mocked(getSessionUser).mockResolvedValue({ userId: USER, sessionId: "s", signedInAt: 0 });
    const db = fakeDb({ rpc: { account_room: () => null } });
    expect(await readAccount(db, post().request)).toEqual({ state: "unknown" });
  });
});

// W6 item 8, ruling H142: the room's four pages. Each reads its own function with the session's user and nothing else,
// answers the sign-in form without a session, and the calm "not found" state when no contact is the session's.
describe.each([
  {
    page: "My properties",
    read: readProperties,
    rpc: "account_properties",
    data: { properties: [] },
  },
  { page: "Invoices", read: readInvoices, rpc: "account_invoices", data: { invoices: [] } },
  {
    page: "Credits",
    read: readCredits,
    rpc: "account_credits",
    data: { balance: 0, purchased: 0, used: 0, entries: [] },
  },
  { page: "Reports", read: readReports, rpc: "account_reports", data: { properties: [] } },
])("the $page page", ({ read, rpc, data }) => {
  it("shows the sign-in form without a session, and reads nothing", async () => {
    vi.mocked(getSessionUser).mockResolvedValue(null);
    const db = fakeDb();
    expect(await read(db, post().request)).toEqual({ state: "signed-out" });
    expect(db.calls).toEqual([]);
  });

  it("reads its own function for the session's own user and names whose room it is", async () => {
    vi.mocked(getSessionUser).mockResolvedValue({ userId: USER, sessionId: "s", signedInAt: 0 });
    const db = fakeDb({ rpc: { [rpc]: () => ({ name: "Test Owner", email: EMAIL, ...data }) } });
    expect(await read(db, post().request)).toEqual({
      state: "room",
      name: "Test Owner",
      email: EMAIL,
      ...data,
    });
    expect(db.calls).toEqual([{ kind: "rpc", name: rpc, args: [{ p_user: USER }] }]);
  });

  it("says the account was not found when no contact is the session's", async () => {
    vi.mocked(getSessionUser).mockResolvedValue({ userId: USER, sessionId: "s", signedInAt: 0 });
    const db = fakeDb({ rpc: { [rpc]: () => null } });
    expect(await read(db, post().request)).toEqual({ state: "unknown" });
  });

  it("refuses an answer that is not the page's shape instead of showing it", async () => {
    vi.mocked(getSessionUser).mockResolvedValue({ userId: USER, sessionId: "s", signedInAt: 0 });
    const db = fakeDb({ rpc: { [rpc]: () => ({ name: "Test Owner", email: EMAIL, junk: 1 }) } });
    await expect(read(db, post().request)).rejects.toThrow();
  });
});

// W6 item 8 (phase 2), ruling H142: photographs added to an open request. The session's own user is the only one the
// database is asked about, the files are signed only after the database declared them, and a refusal signs nothing.
describe("addPhotos", () => {
  const SUBMISSION = "00000000-0000-4000-8000-0000000000c1";
  const MEDIA = [
    "00000000-0000-4000-8000-0000000000d1",
    "00000000-0000-4000-8000-0000000000d2",
  ] as const;
  const photos = {
    submission_id: SUBMISSION,
    media: [
      { name: "front.jpg", size: 1000, type: "image/jpeg" as const },
      { name: "back.heic", size: 2000, type: "image/heic" as const },
    ],
  };
  const declared = () => [
    { media_id: MEDIA[0], index: 0, storage_path: `${SUBMISSION}/${MEDIA[0]}.jpg` },
    { media_id: MEDIA[1], index: 1, storage_path: `${SUBMISSION}/${MEDIA[1]}.heic` },
  ];

  beforeEach(() => {
    vi.mocked(signUpload)
      .mockReset()
      .mockImplementation((_db, _submission, media) =>
        Promise.resolve({
          url: `https://storage.test/${media}`,
          thumb_url: `https://storage.test/${media}.thumb`,
        }),
      );
  });

  it("declares the photographs for the session's own user and signs each, matched to the list by position", async () => {
    vi.mocked(getSessionUser).mockResolvedValue({ userId: USER, sessionId: "s", signedInAt: 0 });
    const db = fakeDb({ rpc: { account_add_photos: declared } });
    expect(await addPhotos(db, post().request, photos)).toEqual({
      uploads: [
        {
          media_id: MEDIA[0],
          index: 0,
          url: `https://storage.test/${MEDIA[0]}`,
          thumb_url: `https://storage.test/${MEDIA[0]}.thumb`,
        },
        {
          media_id: MEDIA[1],
          index: 1,
          url: `https://storage.test/${MEDIA[1]}`,
          thumb_url: `https://storage.test/${MEDIA[1]}.thumb`,
        },
      ],
    });
    expect(db.calls).toEqual([
      {
        kind: "rpc",
        name: "account_add_photos",
        args: [{ p_user: USER, p_submission_id: SUBMISSION, p_media: photos.media }],
      },
    ]);
    expect(vi.mocked(signUpload).mock.calls.map(([, , media, path]) => [media, path])).toEqual(
      declared().map((entry) => [entry.media_id, entry.storage_path]),
    );
  });

  it("refuses a post from another origin before anything is read or written", async () => {
    vi.mocked(getSessionUser).mockResolvedValue({ userId: USER, sessionId: "s", signedInAt: 0 });
    const db = fakeDb();
    await expect(
      addPhotos(db, post({ origin: "https://evil.example" }).request, photos),
    ).rejects.toMatchObject({
      code: "csrf",
    });
    expect(db.calls).toEqual([]);
  });

  it("asks a person without a session to sign in, and touches nothing", async () => {
    vi.mocked(getSessionUser).mockResolvedValue(null);
    const db = fakeDb();
    await expect(addPhotos(db, post().request, photos)).rejects.toMatchObject({
      code: "session_expired",
    });
    expect(db.calls).toEqual([]);
    expect(vi.mocked(signUpload)).not.toHaveBeenCalled();
  });

  it("signs nothing when the database refuses the request (not theirs, not open, over the limit)", async () => {
    vi.mocked(getSessionUser).mockResolvedValue({ userId: USER, sessionId: "s", signedInAt: 0 });
    const db = fakeDb({
      rpc: { account_add_photos: () => Object.assign(new Error("wrong_state"), { code: "P0001" }) },
    });
    await expect(addPhotos(db, post().request, photos)).rejects.toMatchObject({
      code: "wrong_state",
    });
    expect(vi.mocked(signUpload)).not.toHaveBeenCalled();
  });
});

describe("sendAccountLink", () => {
  const world = (rpc: FakeDbOptions["rpc"] = {}) =>
    fakeDb({ rpc: { enqueue_job: () => "00000000-0000-4000-8000-0000000000d1", ...rpc } });

  it("answers a known and an unknown address the same way, without waiting for the lookup", async () => {
    const seen = await Promise.all(
      [true, false].map(async (known) => {
        let release: (value: boolean) => void = () => undefined;
        const lookup = new Promise<boolean>((resolve) => {
          release = resolve;
        });
        const db = world({ account_can_sign_in: () => lookup });
        const { request, afterAnswer } = post();
        // The lookup never answers before the send does: an answer that waited for it would lose this race.
        const answer = await Promise.race([
          sendAccountLink(db, request, env, input),
          new Promise((resolve) => setTimeout(() => resolve("waited for the lookup"), 500)),
        ]);
        const before = db.calls.map((call) => call.name);
        release(known);
        await afterAnswer();
        return { answer, before, after: enqueued(db).length };
      }),
    );
    expect(seen).toEqual([
      { answer: { status: "sent" }, before: ["account_can_sign_in"], after: 1 },
      { answer: { status: "sent" }, before: ["account_can_sign_in"], after: 0 },
    ]);
  });

  it("queues the sign-in email for a contact's address after the answer", async () => {
    const db = world({ account_can_sign_in: () => true });
    const { request, afterAnswer } = post();
    expect(await sendAccountLink(db, request, env, input)).toEqual({ status: "sent" });
    await afterAnswer();
    expect(enqueued(db)).toEqual([
      {
        p_type: "send_email",
        p_payload: { params: { template: "account_link" }, data: { email: EMAIL } },
        p_idempotency_key: expect.stringMatching(/^account_link:[0-9a-f-]{36}$/) as unknown,
        p_heavy: false,
      },
    ]);
  });

  it("logs when the request carries no waitUntil, and stays quiet when it does", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const db = world({ account_can_sign_in: () => false });
      const carried = post();
      await sendAccountLink(db, carried.request, env, input);
      await carried.afterAnswer();
      expect(warn).not.toHaveBeenCalled();
      // the same post as the dev server or a server function without the Worker's `waitUntil` sees it
      const bare = new Request(`${SITE}/_serverfn/account`, {
        method: "POST",
        headers: { "cf-connecting-ip": IP, origin: SITE },
      });
      expect(await sendAccountLink(db, bare, env, input)).toEqual({ status: "sent" });
      expect(warn.mock.calls.map(([line]) => String(line))).toEqual([
        JSON.stringify({ level: "warn", event: "wait_until_missing", route: "account-send-link" }),
      ]);
    } finally {
      warn.mockRestore();
    }
  });

  it("checks the hourly limits per address of origin and per email before the answer", async () => {
    const db = world({ account_can_sign_in: () => false });
    const { request, afterAnswer } = post();
    await sendAccountLink(db, request, env, input);
    await afterAnswer();
    expect(vi.mocked(checkMemory).mock.calls).toEqual([["account-send-link:ip", IP, 5, 3_600_000]]);
    expect(vi.mocked(checkDb).mock.calls.map((call) => call[1])).toEqual([
      [
        {
          bucket: "account-send-link:ip",
          keyHash: await hashKey(SALT, IP),
          limit: 5,
          windowSeconds: 3600,
        },
        {
          bucket: "account-send-link:email",
          keyHash: await hashKey(SALT, EMAIL),
          limit: 3,
          windowSeconds: 3600,
        },
      ],
    ]);
  });

  it("caps the links of every address together, an hour and a day, and queues none past the cap", async () => {
    vi.mocked(checkDb)
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false, retryAfter: 600 });
    const db = world({ account_can_sign_in: () => true });
    const { request, afterAnswer } = post();
    await sendAccountLink(db, request, env, input);
    await afterAnswer();
    const all = await hashKey(SALT, "all");
    expect(vi.mocked(checkDb).mock.calls[1]?.[1]).toEqual([
      { bucket: "account-send-link:all", keyHash: all, limit: 10, windowSeconds: 3600 },
      { bucket: "account-send-link:all", keyHash: all, limit: 40, windowSeconds: 86_400 },
    ]);
    expect(enqueued(db)).toEqual([]);
  });

  it("answers sent and looks nothing up when the bot check fails", async () => {
    vi.mocked(verifyTurnstile).mockResolvedValue("fail");
    const db = world();
    const { request, afterAnswer } = post();
    expect(await sendAccountLink(db, request, env, input)).toEqual({ status: "sent" });
    await afterAnswer();
    expect(db.calls).toEqual([]);
  });

  it("answers sent and looks nothing up past the in-memory limit", async () => {
    vi.mocked(checkMemory).mockReturnValue({ ok: false, retryAfter: 3600 });
    const db = world();
    const { request, afterAnswer } = post();
    expect(await sendAccountLink(db, request, env, input)).toEqual({ status: "sent" });
    await afterAnswer();
    expect([db.calls, vi.mocked(checkDb).mock.calls.length]).toEqual([[], 0]);
  });

  it("answers sent and looks nothing up past the hourly limit", async () => {
    vi.mocked(checkDb).mockResolvedValue({ ok: false, retryAfter: 3600 });
    const db = world();
    const { request, afterAnswer } = post();
    expect(await sendAccountLink(db, request, env, input)).toEqual({ status: "sent" });
    await afterAnswer();
    expect(db.calls).toEqual([]);
  });

  it("refuses a post from another site", async () => {
    const db = world();
    const refused = await sendAccountLink(
      db,
      post({ origin: "https://elsewhere.example" }).request,
      env,
      input,
    ).catch((error: unknown) => error);
    expect(refused instanceof AppError ? refused.code : refused).toBe("csrf");
  });
});

describe("verifyAccountLink and signOutAccount", () => {
  const session = { access_token: "t", user: { id: USER } };

  it("signs in with a token that holds", async () => {
    auth.verifyOtp.mockResolvedValue({ data: { session }, error: null });
    expect(await verifyAccountLink(fakeDb(), post().request, { token_hash: "hash" })).toEqual({
      status: "signed-in",
    });
    expect(auth.verifyOtp).toHaveBeenCalledWith({ type: "email", token_hash: "hash" });
    expect(vi.mocked(enabledRoles).mock.calls[0]?.[1]).toBe(USER);
  });

  it("answers expired for a spent or old token", async () => {
    auth.verifyOtp.mockResolvedValue({ data: { session: null }, error: new Error("expired") });
    expect(await verifyAccountLink(fakeDb(), post().request, { token_hash: "hash" })).toEqual({
      status: "expired",
    });
  });

  it("does not sign in a person on the team: the session ends here and no cookie leaves", async () => {
    auth.verifyOtp.mockResolvedValue({ data: { session }, error: null });
    vi.mocked(enabledRoles).mockResolvedValue(["chief_editor"]);
    const { request } = post();
    expect(await verifyAccountLink(fakeDb(), request, { token_hash: "hash" })).toEqual({
      status: "staff",
    });
    expect(auth.signOut.mock.calls).toEqual([[{ scope: "local" }]]);
    expect(vi.mocked(takeIssuedCookies).mock.calls).toEqual([[request]]);
  });

  it("refuses to spend a token posted from another site", async () => {
    const refused = await verifyAccountLink(
      fakeDb(),
      post({ origin: "https://elsewhere.example" }).request,
      { token_hash: "hash" },
    ).catch((error: unknown) => error);
    expect([
      refused instanceof AppError ? refused.code : refused,
      auth.verifyOtp.mock.calls.length,
    ]).toEqual(["csrf", 0]);
  });

  it("signs out this session only", async () => {
    expect(await signOutAccount(post().request)).toEqual({ status: "signed-out" });
    expect(auth.signOut.mock.calls).toEqual([[{ scope: "local" }]]);
  });

  it("refuses a sign-out posted from another site", async () => {
    const refused = await signOutAccount(
      post({ origin: "https://elsewhere.example" }).request,
    ).catch((error: unknown) => error);
    expect([refused instanceof AppError ? refused.code : refused, auth.signOut.mock.calls]).toEqual(
      ["csrf", []],
    );
  });
});
