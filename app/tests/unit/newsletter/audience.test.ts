import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotFound, RateLimited } from "../../../src/server/channels/resend";
import { NonRetryableError } from "../../../src/server/jobs/types";
import {
  audiencesFor,
  MARKET_AUDIENCE,
  syncAudience,
  type AudienceSubscriber,
} from "../../../src/server/newsletter/audience";
import { BUILD_SHARE, emailEnv, NOW, PRODUCTION_SHARE } from "../../fixtures/email-send";
import { newsletterDb } from "../../fixtures/newsletter-world";

// B11 invariants 2 and 13 (G14, DL-06, INT-02): `syncAudience` against a Resend that keeps its contacts and segments
// as the real one does (contacts are global, a segment holds contact ids). Every request is recorded as
// `<METHOD> <path>`; the database is B5's email world with the three contact functions registered.

const SEGMENT = "seg-place-notes";

interface Contact {
  id: string;
  email: string;
  unsubscribed: boolean;
}

interface Member {
  id: string;
  email: string;
  resend_contact_id: string | null;
}

function fakeResend(start: Contact[] = []) {
  const contacts = new Map(start.map((contact) => [contact.id, { ...contact }]));
  const segment = new Set(start.map(({ id }) => id));
  const requests: string[] = [];
  let next = 0;
  const json = (body: unknown, status = 200) => Promise.resolve(Response.json(body, { status }));
  const missing = () => json({ name: "not_found", message: "not found", statusCode: 404 }, 404);
  vi.stubGlobal("fetch", (input: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const path = decodeURIComponent(new URL(input).pathname);
    requests.push(`${method} ${path}`);
    const body: unknown = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    const [, , id = "", , segmentId] = path.split("/");
    const byId = contacts.get(id) ?? [...contacts.values()].find(({ email }) => email === id);
    if (method === "GET" && path === `/segments/${SEGMENT}/contacts`) {
      return json({ data: [...segment].flatMap((key) => contacts.get(key) ?? []) });
    }
    if (method === "POST" && path === "/contacts") {
      next += 1;
      const created = {
        id: `c-new-${String(next)}`,
        email: String(Reflect.get(Object(body), "email")),
        unsubscribed: false,
      };
      contacts.set(created.id, created);
      segment.add(created.id);
      return json({ id: created.id }, 201);
    }
    if (byId === undefined) return missing();
    if (method === "GET" && path === `/contacts/${id}`) return json(byId);
    if (method === "POST" && segmentId !== undefined) {
      segment.add(byId.id);
      return json({}, 201);
    }
    if (method === "DELETE" && segmentId !== undefined) {
      return segment.delete(byId.id) ? json({ deleted: true }) : missing();
    }
    if (method === "GET" && path.endsWith("/segments")) {
      return json({ data: segment.has(byId.id) ? [{ id: SEGMENT }] : [] });
    }
    if (method === "DELETE") {
      contacts.delete(byId.id);
      return json({ deleted: true });
    }
    if (method === "PATCH") {
      byId.unsubscribed = Reflect.get(Object(body), "unsubscribed") === true;
      return json({ id: byId.id });
    }
    return Promise.reject(new Error(`unrouted ${method} ${path}`));
  });
  return { requests, contacts, segment };
}

/** The database: `newsletter_audience_members` answers `members` (a null contact id as the SQL sends it). */
function world(members: Member[], share: object = PRODUCTION_SHARE) {
  const writes: string[] = [];
  const { db } = newsletterDb(
    {
      settings: [
        { key: "email", value: share },
        { key: "resend", value: { audiences: { "place-notes": SEGMENT } } },
      ],
    },
    {
      newsletter_audience_members: () => members,
      newsletter_set_contact: (args) => {
        writes.push(`set ${String(args["p_subscriber"])} ${String(args["p_contact_id"])}`);
        return null;
      },
      newsletter_clear_contact: (args) => {
        writes.push(`clear ${String(args["p_contact_id"])}`);
        return 1;
      },
    },
  );
  return { db, writes };
}

const member = (n: number, contact: string | null = null): Member => ({
  id: `sub-${String(n)}`,
  email: `reader${String(n)}@gmail.com`,
  resend_contact_id: contact,
});

const contact = (n: number, unsubscribed = false): Contact => ({
  id: `c-${String(n)}`,
  email: `reader${String(n)}@gmail.com`,
  unsubscribed,
});

const subscriber = (values: Partial<AudienceSubscriber> = {}): AudienceSubscriber => ({
  email: "reader@gmail.com",
  source: "footer",
  markets: [],
  confirmed_at: "2026-10-01T00:00:00.000Z",
  unsubscribed_at: null,
  archived_at: null,
  ...values,
});

const changes = (requests: string[]) => requests.filter((request) => !request.startsWith("GET "));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  emailEnv();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("MARKET_AUDIENCE and audiencesFor", () => {
  it("maps each of the three market slugs to its audience, as the SQL case of newsletter_audience_members does", () => {
    const sql = readFileSync(
      new URL("../../../supabase/sql/functions/newsletter_audience_members.sql", import.meta.url),
      "utf8",
    );
    const pairs = [...sql.matchAll(/when '(market-[a-z]+)' then '([a-z-]+)'/g)].map(
      ([, key = "", slug = ""]) => [slug, key],
    );
    expect(MARKET_AUDIENCE).toEqual({
      california: "market-ca",
      "new-york": "market-ny",
      florida: "market-fl",
    });
    expect(Object.fromEntries(pairs)).toEqual(MARKET_AUDIENCE);
  });

  it("puts a confirmed Place Notes subscriber in place-notes and the audience of each of its markets", () => {
    expect(audiencesFor(subscriber({ markets: ["california", "florida"] }))).toEqual([
      "place-notes",
      "market-ca",
      "market-fl",
    ]);
  });

  it("adds an interest:california subscriber to no audience", () => {
    expect(
      audiencesFor(subscriber({ source: "interest:california", markets: ["california"] })),
    ).toEqual([]);
  });

  it("adds no unconfirmed, unsubscribed, archived or anonymised subscriber", () => {
    expect(
      [
        subscriber({ confirmed_at: null }),
        subscriber({ unsubscribed_at: "2026-10-02T00:00:00.000Z" }),
        subscriber({ archived_at: "2026-10-02T00:00:00.000Z" }),
        subscriber({ email: "a1b2@deleted.invalid" }),
      ].map(audiencesFor),
    ).toEqual([[], [], [], []]);
  });
});

describe("syncAudience", () => {
  it("adds each member missing from the listed contacts once and stores its id", async () => {
    const resend = fakeResend([contact(1)]);
    const { db, writes } = world([member(1, "c-1"), member(2), member(3)]);
    expect(await syncAudience(db, "place-notes")).toEqual({ added: 2, removed: 0, members: 3 });
    expect(resend.requests.filter((request) => request === "POST /contacts")).toHaveLength(2);
    expect(writes).toEqual(["set sub-2 c-new-1", "set sub-3 c-new-2"]);
  });

  it("makes no add or remove call on a second run with nothing changed", async () => {
    const resend = fakeResend([contact(1)]);
    const first = world([member(1, "c-1"), member(2)]);
    await syncAudience(first.db, "place-notes");
    const before = resend.requests.length;
    const second = world([member(1, "c-1"), member(2, "c-new-1")]);
    expect(await syncAudience(second.db, "place-notes")).toEqual({
      added: 0,
      removed: 0,
      members: 2,
    });
    expect(changes(resend.requests.slice(before))).toEqual([]);
    expect(second.writes).toEqual([]);
  });

  it("removes a suppressed or anonymised listed contact and clears its resend_contact_id", async () => {
    const resend = fakeResend([contact(1), contact(2)]);
    const { db, writes } = world([member(1, "c-1")]);
    expect(await syncAudience(db, "place-notes")).toEqual({ added: 0, removed: 1, members: 1 });
    expect(changes(resend.requests)).toEqual([
      `DELETE /contacts/c-2/segments/${SEGMENT}`,
      "DELETE /contacts/c-2",
    ]);
    expect(writes).toEqual(["clear c-2"]);
  });

  it("subscribes again a member re-confirmed after an unsubscribe, whose row lost the contact id (DL-06)", async () => {
    const resend = fakeResend([contact(1, true)]);
    const { db, writes } = world([member(1)]);
    await syncAudience(db, "place-notes");
    expect(changes(resend.requests)).toEqual(["PATCH /contacts/c-1"]);
    expect(resend.contacts.get("c-1")?.unsubscribed).toBe(false);
    expect(writes).toEqual(["set sub-1 c-1"]);
  });

  it("leaves alone a listed unsubscribed contact whose member row still holds its id", async () => {
    const resend = fakeResend([contact(1, true)]);
    const { db, writes } = world([member(1, "c-1")]);
    await syncAudience(db, "place-notes");
    expect(changes(resend.requests)).toEqual([]);
    expect(writes).toEqual([]);
  });

  it("adds only the members matching settings.email.dev_recipients with MOP_ENV=preview (INT-02)", async () => {
    emailEnv({ MOP_ENV: "preview", EMAIL_LIVE: "1" });
    const resend = fakeResend();
    const allowed = {
      id: "sub-9",
      email: "admin+notes@matterofplace.com",
      resend_contact_id: null,
    };
    const { db } = world([member(1), allowed], BUILD_SHARE);
    expect(await syncAudience(db, "place-notes")).toEqual({ added: 1, removed: 0, members: 1 });
    expect([...resend.contacts.values()].map(({ email }) => email)).toEqual([allowed.email]);
  });

  it("rejects with RateLimited on a 429, so the caller returns retry_at", async () => {
    vi.stubGlobal("fetch", () =>
      Promise.resolve(
        Response.json(
          { name: "rate_limit_exceeded", message: "slow down", statusCode: 429 },
          { status: 429, headers: { "retry-after": "4" } },
        ),
      ),
    );
    const error: unknown = await syncAudience(world([member(1)]).db, "place-notes").catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(RateLimited);
  });

  it("rejects a 422 as non-retryable", async () => {
    vi.stubGlobal("fetch", () =>
      Promise.resolve(
        Response.json(
          { name: "invalid_parameter", message: "bad", statusCode: 422 },
          { status: 422 },
        ),
      ),
    );
    const error: unknown = await syncAudience(world([member(1)]).db, "place-notes").catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(NonRetryableError);
    expect(error).not.toBeInstanceOf(NotFound);
  });

  it("makes no call and writes nothing with EMAIL_DRY_RUN=1", async () => {
    emailEnv({ EMAIL_DRY_RUN: "1" });
    const resend = fakeResend([contact(5)]);
    const { db, writes } = world([member(1), member(2)]);
    expect(await syncAudience(db, "place-notes")).toEqual({ dry_run: true, members: 2 });
    expect(resend.requests).toEqual([]);
    expect(writes).toEqual([]);
  });
});
