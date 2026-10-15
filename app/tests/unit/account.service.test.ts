import "../fixtures/worker-env";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  readAccount,
  sendAccountLink,
  signOutAccount,
  verifyAccountLink,
} from "../../src/server/account/service";
import { env } from "../../src/server/lib/env";
import { AppError } from "../../src/server/lib/errors";
import { checkDb } from "../../src/server/lib/ratelimit";
import { getSessionUser } from "../../src/server/lib/session";
import { verifyTurnstile } from "../../src/server/lib/turnstile";
import { fakeDb, type FakeDbOptions } from "../fixtures/fake-db";

// W6 item 7, ruling H114: the client room's service. The room reads `account_room` with the verified session's user
// only; a link goes only to a contact's address and the answer is always `sent`; the link is spent by a same-origin post.

const auth = {
  signInWithOtp: vi.fn(),
  verifyOtp: vi.fn(),
  signOut: vi.fn(),
};

vi.mock("../../src/server/lib/session", () => ({
  authClient: () => auth,
  getSessionUser: vi.fn(),
}));
vi.mock("../../src/server/lib/turnstile", () => ({ verifyTurnstile: vi.fn() }));
vi.mock("../../src/server/lib/ratelimit", () => ({
  checkMemory: () => ({ ok: true }),
  checkDb: vi.fn(),
}));

const USER = "00000000-0000-4000-8000-0000000000a1";
const REQUEST_ID = "00000000-0000-4000-8000-0000000000b1";
const SITE = "https://matterofplace.com";
const post = (headers: Record<string, string> = { origin: SITE }) =>
  new Request(`${SITE}/_serverfn/account`, { method: "POST", headers });
const input = { email: "owner@example.test", turnstile: "token" };

function world(rpc: FakeDbOptions["rpc"] = {}) {
  const createUser = vi.fn((attributes: { email: string; email_confirm: boolean }) =>
    Promise.resolve({ data: { user: { id: USER, email: attributes.email } }, error: null }),
  );
  const db = Object.assign(fakeDb({ rpc }), { auth: { admin: { createUser } } });
  return { db, createUser };
}

beforeEach(() => {
  vi.mocked(getSessionUser).mockReset();
  vi.mocked(verifyTurnstile).mockResolvedValue("pass");
  vi.mocked(checkDb).mockResolvedValue({ ok: true });
  auth.signInWithOtp.mockReset().mockResolvedValue({ data: {}, error: null });
  auth.verifyOtp.mockReset();
  auth.signOut.mockReset().mockResolvedValue({ error: null });
});

describe("readAccount", () => {
  it("shows the sign-in form without a session, and reads nothing", async () => {
    vi.mocked(getSessionUser).mockResolvedValue(null);
    const { db } = world();
    expect(await readAccount(db, post())).toEqual({ state: "signed-out" });
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
    const { db } = world({ account_room: () => ({ name: "Test Owner", requests: [request] }) });
    expect(await readAccount(db, post())).toEqual({
      state: "room",
      name: "Test Owner",
      requests: [request],
    });
    expect(db.calls).toEqual([{ kind: "rpc", name: "account_room", args: [{ p_user: USER }] }]);
  });

  it("says the account was not found when no contact is the session's", async () => {
    vi.mocked(getSessionUser).mockResolvedValue({ userId: USER, sessionId: "s", signedInAt: 0 });
    const { db } = world({ account_room: () => null });
    expect(await readAccount(db, post())).toEqual({ state: "unknown" });
  });
});

describe("sendAccountLink", () => {
  it("mails a link to a contact's address, to the confirm page", async () => {
    const { db, createUser } = world({ account_can_sign_in: () => true });
    expect(await sendAccountLink(db, post(), env, input)).toEqual({ status: "sent" });
    expect(createUser).toHaveBeenCalledWith({ email: "owner@example.test", email_confirm: true });
    expect(auth.signInWithOtp).toHaveBeenCalledWith({
      email: "owner@example.test",
      options: { shouldCreateUser: false, emailRedirectTo: `${SITE}/account/confirm` },
    });
  });

  it("answers sent and mails nothing to an address that is not a contact", async () => {
    const { db, createUser } = world({ account_can_sign_in: () => false });
    expect(await sendAccountLink(db, post(), env, input)).toEqual({ status: "sent" });
    expect([createUser.mock.calls.length, auth.signInWithOtp.mock.calls.length]).toEqual([0, 0]);
  });

  it("answers sent and looks nothing up when the bot check fails", async () => {
    vi.mocked(verifyTurnstile).mockResolvedValue("fail");
    const { db } = world();
    expect(await sendAccountLink(db, post(), env, input)).toEqual({ status: "sent" });
    expect(db.calls).toEqual([]);
  });

  it("answers sent and looks nothing up past the hourly limit", async () => {
    vi.mocked(checkDb).mockResolvedValue({ ok: false, retryAfter: 3600 });
    const { db } = world();
    expect(await sendAccountLink(db, post(), env, input)).toEqual({ status: "sent" });
    expect(db.calls).toEqual([]);
  });

  it("refuses a post from another site", async () => {
    const { db } = world();
    const refused = await sendAccountLink(
      db,
      post({ origin: "https://elsewhere.example" }),
      env,
      input,
    ).catch((error: unknown) => error);
    expect(refused instanceof AppError ? refused.code : refused).toBe("csrf");
  });
});

describe("verifyAccountLink and signOutAccount", () => {
  it("signs in with a token that holds", async () => {
    auth.verifyOtp.mockResolvedValue({ data: { session: { access_token: "t" } }, error: null });
    expect(await verifyAccountLink(post(), { token_hash: "hash" })).toEqual({
      status: "signed-in",
    });
    expect(auth.verifyOtp).toHaveBeenCalledWith({ type: "email", token_hash: "hash" });
  });

  it("answers expired for a spent or old token", async () => {
    auth.verifyOtp.mockResolvedValue({ data: { session: null }, error: new Error("expired") });
    expect(await verifyAccountLink(post(), { token_hash: "hash" })).toEqual({ status: "expired" });
  });

  it("refuses to spend a token posted from another site", async () => {
    const refused = await verifyAccountLink(post({ origin: "https://elsewhere.example" }), {
      token_hash: "hash",
    }).catch((error: unknown) => error);
    expect([
      refused instanceof AppError ? refused.code : refused,
      auth.verifyOtp.mock.calls.length,
    ]).toEqual(["csrf", 0]);
  });

  it("signs out", async () => {
    expect(await signOutAccount(post())).toEqual({ status: "signed-out" });
    expect(auth.signOut).toHaveBeenCalledTimes(1);
  });
});
