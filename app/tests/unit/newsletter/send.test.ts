import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addContact,
  BULK_DOMAIN,
  Conflict,
  createBroadcast,
  deleteContact,
  ensureAudience,
  getBroadcast,
  getDomainTracking,
  listContacts,
  NotFound,
  RateLimited,
  removeContact,
  sendBroadcast,
  setDomainTracking,
  Transient,
  updateContact,
} from "../../../src/server/channels/resend";
import { getSystemJob } from "../../../src/server/jobs/system/index";
import { newsletterSend } from "../../../src/server/jobs/system/newsletter-send";
import { NonRetryableError } from "../../../src/server/jobs/types";
import {
  CONTACT,
  emailEnv,
  failure as outcomeOf,
  FROM_BULK,
  NOW,
  PRODUCTION_SHARE,
  stepCtx,
} from "../../fixtures/email-send";
import { fakeDb } from "../../fixtures/fake-db";
import {
  newsletterDb,
  propertyBlock,
  propertyRow,
  storyBlock,
  storyRow,
  uuid,
  type Row,
} from "../../fixtures/newsletter-world";

// B11 step 2: the Resend adapter against a fake provider. Every call is recorded by method, path and JSON body; a
// call the test did not route fails loudly, so a method that reaches for an endpoint nobody listed is red.

interface Reply {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
}

interface Call {
  key: string;
  authorization: string | null;
  body: unknown;
}

function provider(routes: Record<string, Reply | (() => Reply)>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input);
    const key = `${init?.method ?? "GET"} ${url.pathname}`;
    calls.push({
      key,
      authorization: new Headers(init?.headers).get("authorization"),
      body: typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined,
    });
    const route = routes[key];
    if (route === undefined) return Promise.reject(new Error(`unrouted ${key}`));
    const reply = typeof route === "function" ? route() : route;
    return Promise.resolve(
      new Response(JSON.stringify(reply.body ?? {}), {
        status: reply.status ?? 200,
        headers: reply.headers ?? {},
      }),
    );
  });
  return calls;
}

const keys = (calls: Call[]): string[] => calls.map((call) => call.key);

const failure = (name: string, status: number, headers: Record<string, string> = {}): Reply => ({
  status,
  body: { name, message: name, statusCode: status },
  headers,
});

const SEGMENT = "58d550b4-fec1-420d-9c36-71a8f2d610cc";
const CONTACT_ID = "61a9c399-92a9-4524-8f59-e2e009450361";
const DRAFT = { object: "broadcast", id: "br_1" };

const broadcastInput = {
  audienceId: SEGMENT,
  from: FROM_BULK,
  replyTo: CONTACT,
  subject: "Place Notes No. 1",
  preheader: "Three places",
  html: "<p>{{{RESEND_UNSUBSCRIBE_URL}}}</p>",
  text: "Three places",
  headers: {
    "List-Unsubscribe": "<https://matterofplace.com/u>",
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  },
};

const settingsRow = (audiences: Record<string, string>) => ({
  key: "resend",
  value: { audiences },
  updated_at: NOW.toISOString(),
  updated_by: null,
});

function audienceDb(audiences: Record<string, string>) {
  const rpc = vi.fn(() => Promise.resolve({ data: null, error: null }));
  const db = Object.assign(fakeDb({ tables: { settings: [settingsRow(audiences)] } }), { rpc });
  return { db, rpc };
}

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

describe("resend adapter calls", () => {
  it("creates a broadcast with both List-Unsubscribe headers, then sends it, in that order", async () => {
    const calls = provider({
      "POST /broadcasts": { body: DRAFT },
      "POST /broadcasts/br_1/send": { body: { id: "br_1" } },
    });
    const id = await createBroadcast(broadcastInput);
    await sendBroadcast(id);
    expect(keys(calls)).toEqual(["POST /broadcasts", "POST /broadcasts/br_1/send"]);
    expect(calls[0]?.authorization).toBe("Bearer re_unit_test_only");
    expect(calls[0]?.body).toEqual({
      segment_id: SEGMENT,
      from: FROM_BULK,
      reply_to: CONTACT,
      subject: "Place Notes No. 1",
      preview_text: "Three places",
      html: "<p>{{{RESEND_UNSUBSCRIBE_URL}}}</p>",
      text: "Three places",
      headers: broadcastInput.headers,
    });
  });

  it("creates the audience once: a second call with the stored id makes no request", async () => {
    vi.stubEnv("SITE_URL", "https://mop-dev.example");
    const calls = provider({
      "GET /segments": { body: { data: [{ id: "old", name: "General" }] } },
      "POST /segments": { body: { id: "seg_1", name: "dev-place-notes" } },
    });
    const first = audienceDb({});
    expect(await ensureAudience(first.db, "place-notes")).toBe("seg_1");
    expect(calls[1]?.body).toEqual({ name: "dev-place-notes" });
    expect(first.rpc).toHaveBeenCalledWith("newsletter_set_audience", {
      p_key: "place-notes",
      p_audience_id: "seg_1",
    });
    const second = audienceDb({ "place-notes": "seg_1" });
    expect(await ensureAudience(second.db, "place-notes")).toBe("seg_1");
    expect(calls).toHaveLength(2);
    expect(second.rpc).not.toHaveBeenCalled();
  });

  it("names the production audience without the dev prefix", async () => {
    const calls = provider({
      "GET /segments": { body: { data: [] } },
      "POST /segments": { body: { id: "seg_2" } },
    });
    await ensureAudience(audienceDb({}).db, "market-ca");
    expect(calls[1]?.body).toEqual({ name: "market-ca" });
  });

  it("adopts a segment of the right name left by a crash before its id was stored", async () => {
    vi.stubEnv("SITE_URL", "https://mop-dev.example");
    const calls = provider({
      "GET /segments": { body: { data: [{ id: "seg_9", name: "dev-market-fl" }] } },
    });
    const { db, rpc } = audienceDb({});
    expect(await ensureAudience(db, "market-fl")).toBe("seg_9");
    expect(keys(calls)).toEqual(["GET /segments"]);
    expect(rpc).toHaveBeenCalledOnce();
  });

  it("hits the method and path of the current API for each contact and broadcast call", async () => {
    const calls = provider({
      [`GET /segments/${SEGMENT}/contacts`]: {
        body: { data: [{ id: CONTACT_ID, email: "a@example.com", unsubscribed: true }] },
      },
      "GET /contacts/new%40example.com": failure("not_found", 404),
      "POST /contacts": { status: 201, body: { id: CONTACT_ID } },
      [`DELETE /contacts/${CONTACT_ID}/segments/${SEGMENT}`]: { body: { deleted: true } },
      [`GET /contacts/${CONTACT_ID}/segments`]: { body: { data: [{ id: "other" }] } },
      [`DELETE /contacts/${CONTACT_ID}`]: { body: { deleted: true } },
      [`PATCH /contacts/${CONTACT_ID}`]: { body: { id: CONTACT_ID } },
      "GET /broadcasts/br_1": { body: { id: "br_1", status: "sent" } },
    });
    expect(await listContacts(SEGMENT)).toEqual([
      { id: CONTACT_ID, email: "a@example.com", unsubscribed: true },
    ]);
    expect(await addContact(SEGMENT, { email: "new@example.com" })).toEqual({
      id: CONTACT_ID,
      unsubscribed: false,
    });
    expect(await removeContact(SEGMENT, CONTACT_ID)).toBe(true);
    expect(await deleteContact(CONTACT_ID)).toBe(true);
    await updateContact(CONTACT_ID, { unsubscribed: false });
    expect(await getBroadcast("br_1")).toEqual({ id: "br_1", status: "sent" });
    expect(keys(calls)).toEqual([
      `GET /segments/${SEGMENT}/contacts`,
      "GET /contacts/new%40example.com",
      "POST /contacts",
      `DELETE /contacts/${CONTACT_ID}/segments/${SEGMENT}`,
      `GET /contacts/${CONTACT_ID}/segments`,
      `DELETE /contacts/${CONTACT_ID}`,
      `PATCH /contacts/${CONTACT_ID}`,
      "GET /broadcasts/br_1",
    ]);
    expect(calls[2]?.body).toEqual({
      email: "new@example.com",
      unsubscribed: false,
      segments: [{ id: SEGMENT }],
    });
    expect(calls[6]?.body).toEqual({ unsubscribed: false });
  });

  it("sends updateContact as PATCH /contacts/{id} with unsubscribed false", async () => {
    const calls = provider({ [`PATCH /contacts/${CONTACT_ID}`]: { body: { id: CONTACT_ID } } });
    await updateContact(CONTACT_ID, { unsubscribed: false });
    expect(calls).toEqual([
      {
        key: `PATCH /contacts/${CONTACT_ID}`,
        authorization: "Bearer re_unit_test_only",
        body: { unsubscribed: false },
      },
    ]);
  });

  it("does not resubscribe a contact that unsubscribed: adding it only joins the segment", async () => {
    const calls = provider({
      "GET /contacts/gone%40example.com": {
        body: { id: CONTACT_ID, email: "gone@example.com", unsubscribed: true },
      },
      [`POST /contacts/${CONTACT_ID}/segments/${SEGMENT}`]: { status: 201, body: {} },
    });
    expect(await addContact(SEGMENT, { email: "gone@example.com" })).toEqual({
      id: CONTACT_ID,
      unsubscribed: true,
    });
    expect(keys(calls)).not.toContain("POST /contacts");
  });

  it("deletes the contact when its last segment is removed", async () => {
    const calls = provider({
      [`DELETE /contacts/${CONTACT_ID}/segments/${SEGMENT}`]: { body: { deleted: true } },
      [`GET /contacts/${CONTACT_ID}/segments`]: { body: { data: [] } },
      [`DELETE /contacts/${CONTACT_ID}`]: { body: { deleted: true } },
    });
    await removeContact(SEGMENT, CONTACT_ID);
    expect(keys(calls).at(-1)).toBe(`DELETE /contacts/${CONTACT_ID}`);
  });

  it("answers false for a removal that finds nothing instead of failing", async () => {
    provider({
      [`DELETE /contacts/${CONTACT_ID}/segments/${SEGMENT}`]: failure("not_found", 404),
      [`GET /contacts/${CONTACT_ID}/segments`]: failure("not_found", 404),
      [`DELETE /contacts/${CONTACT_ID}`]: failure("not_found", 404),
    });
    expect(await removeContact(SEGMENT, CONTACT_ID)).toBe(false);
    expect(await deleteContact(CONTACT_ID)).toBe(false);
  });

  it("sends click tracking on and open tracking off to the bulk sender's domain", async () => {
    const calls = provider({
      "GET /domains": {
        body: {
          data: [
            { id: "d_root", name: "matterofplace.com", click_tracking: false },
            { id: "d_notes", name: BULK_DOMAIN, click_tracking: false, open_tracking: false },
          ],
        },
      },
      "PATCH /domains/d_notes": { body: { id: "d_notes" } },
    });
    expect(await setDomainTracking({ click: true, open: false })).toEqual({
      click: true,
      open: false,
    });
    expect(keys(calls)).toEqual(["GET /domains", "PATCH /domains/d_notes"]);
    expect(calls[1]?.body).toEqual({ click_tracking: true, open_tracking: false });
  });

  it("reads the two tracking values without writing", async () => {
    const calls = provider({
      "GET /domains": {
        body: { data: [{ id: "d_notes", name: BULK_DOMAIN, click_tracking: true }] },
      },
    });
    expect(await getDomainTracking()).toEqual({ click: true, open: false });
    expect(keys(calls)).toEqual(["GET /domains"]);
  });
});

describe("resend adapter errors", () => {
  const send = (): Promise<string> => sendBroadcast("br_1");

  it("maps a 429 rate_limit_exceeded with Retry-After 5 to RateLimited five seconds ahead", async () => {
    provider({
      "POST /broadcasts/br_1/send": failure("rate_limit_exceeded", 429, { "retry-after": "5" }),
    });
    const error: unknown = await send().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(RateLimited);
    expect(error instanceof RateLimited && error.retryAt).toEqual(new Date(NOW.getTime() + 5000));
  });

  it("maps a 429 daily_quota_exceeded to the next UTC midnight plus one minute", async () => {
    provider({ "POST /broadcasts/br_1/send": failure("daily_quota_exceeded", 429) });
    const error: unknown = await send().catch((caught: unknown) => caught);
    expect(error instanceof RateLimited && error.retryAt).toEqual(
      new Date("2026-10-06T00:01:00.000Z"),
    );
  });

  it("maps a 403 restricted_api_key to NonRetryableError restricted_api_key", async () => {
    provider({ "POST /broadcasts/br_1/send": failure("restricted_api_key", 403) });
    const error: unknown = await send().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(NonRetryableError);
    expect(error instanceof Error && error.message).toBe("restricted_api_key");
  });

  it("types an unnamed 404, a 409 and a 503 as NotFound, Conflict and Transient", async () => {
    provider({
      "GET /broadcasts/gone": failure("not_found", 404),
      "POST /broadcasts/dup/send": failure("conflict", 409),
      "POST /broadcasts/down/send": failure("server_busy", 503),
    });
    await expect(getBroadcast("gone")).rejects.toBeInstanceOf(NotFound);
    await expect(sendBroadcast("dup")).rejects.toBeInstanceOf(Conflict);
    await expect(sendBroadcast("down")).rejects.toBeInstanceOf(Transient);
  });

  it("types a dropped connection as Transient", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("fetch failed")));
    await expect(send()).rejects.toBeInstanceOf(Transient);
  });

  it("refuses a call without RESEND_API_KEY as resend_not_configured", async () => {
    emailEnv({ RESEND_API_KEY: undefined });
    const calls = provider({});
    await expect(send()).rejects.toThrow("resend_not_configured");
    expect(calls).toHaveLength(0);
  });
});

describe("resend adapter fails closed", () => {
  async function everyCall(): Promise<unknown[]> {
    const { db, rpc } = audienceDb({});
    await updateContact(CONTACT_ID, { unsubscribed: false });
    const answers = [
      await ensureAudience(db, "place-notes"),
      await listContacts(SEGMENT),
      await addContact(SEGMENT, { email: "a@example.com" }),
      await removeContact(SEGMENT, CONTACT_ID),
      await deleteContact(CONTACT_ID),
      await createBroadcast(broadcastInput),
      await sendBroadcast("br_1"),
      await getBroadcast("br_1"),
      await getDomainTracking(),
      await setDomainTracking({ click: true, open: false }),
    ];
    expect(rpc).not.toHaveBeenCalled();
    return answers;
  }

  it("makes no request and answers dry_ ids under EMAIL_DRY_RUN=1", async () => {
    emailEnv({ EMAIL_DRY_RUN: "1" });
    const calls = provider({});
    const answers = await everyCall();
    expect(calls).toHaveLength(0);
    expect(answers[0]).toMatch(/^dry_/);
    expect(answers[5]).toMatch(/^dry_/);
    expect(answers[6]).toMatch(/^dry_/);
  });

  it("makes no request to api.resend.com with MOP_ENV=development and no EMAIL_LIVE", async () => {
    emailEnv({ MOP_ENV: "development" });
    const calls = provider({});
    await everyCall();
    expect(calls).toHaveLength(0);
  });

  it("makes requests with MOP_ENV=development when EMAIL_LIVE=1", async () => {
    emailEnv({ MOP_ENV: "development", EMAIL_LIVE: "1" });
    const calls = provider({ "POST /broadcasts": { body: DRAFT } });
    await createBroadcast(broadcastInput);
    expect(keys(calls)).toEqual(["POST /broadcasts"]);
  });
});

// B11 invariants 4 to 6 (INT-10, INT-11): the `newsletter_send` system job against the fake provider above and a
// database whose issue functions keep one issue row as the SQL functions of step 4 do.

const ISSUE_ID = uuid(900);
const LEGAL = { entity: "Omnikom Media LLC", address: "100 Ocean Drive, Miami, FL 33139" };

interface SendWorld {
  issue?: Row;
  recipients?: number;
  sentToday?: number;
  channel?: boolean;
  legal?: { entity: string | null; address: string | null };
  properties?: Row[];
  /** The first `newsletter_mark_sent` calls fail, as a crash after Resend accepted the send would. */
  markSentFails?: number;
}

function sendWorld(options: SendWorld = {}) {
  const issue: Row = {
    id: ISSUE_ID,
    number: 7,
    status: "approved",
    approval_count: 2,
    blocks: [{ id: "intro", type: "intro", text: "Two walks." }, storyBlock(1)],
    subject: "Place Notes No. 7: Under the oaks",
    preheader: "A walk.",
    resend_broadcast_id: null,
    sent_at: null,
    send_error: null,
    metrics: {},
    ...options.issue,
  };
  const notices: unknown[] = [];
  let crashes = options.markSentFails ?? 0;
  const { db } = newsletterDb(
    {
      newsletter_issues: [issue],
      stories: [storyRow(1, { slug: "under-the-oaks" })],
      properties: options.properties ?? [],
      channel_settings: [{ channel: "newsletter", enabled: options.channel ?? true }],
      settings: [
        { key: "email", value: PRODUCTION_SHARE },
        { key: "site", value: { contact: { email: CONTACT }, legal: options.legal ?? LEGAL } },
        { key: "resend", value: { audiences: { "place-notes": SEGMENT } } },
      ],
    },
    {
      newsletter_recipient_count: () => options.recipients ?? 3,
      newsletter_audience_members: () => [],
      email_sent_today: () => options.sentToday ?? 0,
      email_sent_month: () => 0,
      enqueue_job: (args) => {
        notices.push(args["p_payload"]);
        return "job-2";
      },
      newsletter_mark_sending: (args) => {
        const fresh = ["approved", "sending"].includes(String(issue["status"]));
        if (!fresh || issue["approval_count"] !== args["p_approval_count"]) return false;
        issue["status"] = "sending";
        return true;
      },
      newsletter_set_broadcast_id: (args) => {
        issue["resend_broadcast_id"] ??= args["p_broadcast_id"];
        return null;
      },
      newsletter_mark_sent: (args) => {
        if ((crashes -= 1) >= 0) return new Error("connection reset");
        if (issue["status"] !== "sending") return new Error("wrong_state");
        Object.assign(issue, {
          status: "sent",
          sent_at: NOW.toISOString(),
          send_error: null,
          metrics: { recipients: args["p_recipients"] },
        });
        return null;
      },
      newsletter_set_send_error: (args) => {
        issue["send_error"] = args["p_error"];
        return null;
      },
    },
  );
  return { db, issue, notices };
}

const SEND_ROUTES = {
  [`GET /segments/${SEGMENT}/contacts`]: { body: { data: [] } },
  "POST /broadcasts": { body: DRAFT },
  "POST /broadcasts/br_1/send": { body: { id: "br_1" } },
  "GET /broadcasts/br_1": { body: { id: "br_1", status: "draft" } },
};

const runSend = (db: ReturnType<typeof sendWorld>["db"], approvalCount = 2) =>
  newsletterSend.run(
    stepCtx(db, { type: "newsletter_send" }),
    {},
    { issue_id: ISSUE_ID, approval_count: approvalCount },
  );

const sends = (calls: Call[]) => keys(calls).filter((key) => key.endsWith("/send"));

describe("newsletter_send", () => {
  it("is registered with twelve attempts", () => {
    expect(getSystemJob("newsletter_send")).toBe(newsletterSend);
    expect(newsletterSend.maxAttempts).toBe(12);
  });

  it("sends an approved issue: sent, sent_at and metrics.recipients", async () => {
    const calls = provider(SEND_ROUTES);
    const { db, issue } = sendWorld({ recipients: 3 });
    expect(await runSend(db)).toEqual({
      status: "done",
      result: { broadcast_id: "br_1", recipients: 3 },
    });
    expect(issue).toMatchObject({
      status: "sent",
      sent_at: NOW.toISOString(),
      resend_broadcast_id: "br_1",
      metrics: { recipients: 3 },
    });
    expect(sends(calls)).toEqual(["POST /broadcasts/br_1/send"]);
  });

  it("syncs the audience before it creates the broadcast", async () => {
    const calls = provider(SEND_ROUTES);
    await runSend(sendWorld().db);
    expect(keys(calls)).toEqual([
      `GET /segments/${SEGMENT}/contacts`,
      "POST /broadcasts",
      "POST /broadcasts/br_1/send",
    ]);
  });

  it("refuses an issue whose footer has no postal address: footer_incomplete, written to send_error", async () => {
    const calls = provider(SEND_ROUTES);
    const { db, issue } = sendWorld({ legal: { entity: LEGAL.entity, address: null } });
    expect(await outcomeOf(runSend(db))).toEqual({ dead: true, message: "footer_incomplete" });
    expect(issue).toMatchObject({ status: "approved", send_error: "footer_incomplete" });
    expect(calls).toEqual([]);
  });

  it("skips a job whose approval_count is stale", async () => {
    const calls = provider(SEND_ROUTES);
    const { db, issue } = sendWorld();
    expect(await runSend(db, 1)).toEqual({ status: "done", result: { skipped: "stale" } });
    expect(issue["status"]).toBe("approved");
    expect(calls).toEqual([]);
  });

  it("skips with one notice to the admin while the newsletter channel is off", async () => {
    const calls = provider(SEND_ROUTES);
    const { db, notices } = sendWorld({ channel: false });
    expect(await runSend(db)).toEqual({ status: "done", result: { skipped: "channel_disabled" } });
    expect(notices).toEqual([
      {
        params: { headline: "Place Notes No. 7 not sent: the newsletter channel is off" },
        data: {
          summary: "Switch the newsletter channel on, then approve the issue again",
          link_path: "/admin/automation/settings",
        },
      },
    ]);
    expect(calls).toEqual([]);
  });

  it("resumes a crash between create and send with the send only", async () => {
    let attempt = 0;
    const calls = provider({
      ...SEND_ROUTES,
      "POST /broadcasts/br_1/send": () =>
        (attempt += 1) === 1 ? failure("server_busy", 503) : { body: { id: "br_1" } },
    });
    const { db, issue } = sendWorld();
    expect(await outcomeOf(runSend(db))).toEqual({ dead: false, message: "resend_status_503" });
    await runSend(db);
    expect(keys(calls).filter((key) => key.startsWith("POST "))).toEqual([
      "POST /broadcasts",
      "POST /broadcasts/br_1/send",
      "POST /broadcasts/br_1/send",
    ]);
    expect(issue["status"]).toBe("sent");
  });

  it.each(["sent", "queued"])(
    "adopts a stored broadcast Resend answers %s for: no send call, the issue ends sent",
    async (status) => {
      const calls = provider({ "GET /broadcasts/br_1": { body: { id: "br_1", status } } });
      const { db, issue } = sendWorld({
        recipients: 4,
        issue: { status: "sending", resend_broadcast_id: "br_1" },
      });
      expect(await runSend(db)).toEqual({ status: "done", result: { adopted: true } });
      expect(sends(calls)).toEqual([]);
      expect(issue).toMatchObject({ status: "sent", metrics: { recipients: 4 } });
    },
  );

  it("confirms a Conflict from the send through getBroadcast and ends sent with no second send (INT-10)", async () => {
    const calls = provider({
      ...SEND_ROUTES,
      "POST /broadcasts/br_1/send": failure("conflict", 409),
      "GET /broadcasts/br_1": { body: { id: "br_1", status: "sending" } },
    });
    const { db, issue } = sendWorld();
    expect(await runSend(db)).toEqual({ status: "done", result: { adopted: true } });
    expect(sends(calls)).toEqual(["POST /broadcasts/br_1/send"]);
    expect(issue["status"]).toBe("sent");
  });

  it("returns retry_at the next UTC midnight plus a minute on a 429 daily_quota_exceeded (INT-11)", async () => {
    provider({
      ...SEND_ROUTES,
      "POST /broadcasts/br_1/send": failure("daily_quota_exceeded", 429),
    });
    const { db, issue } = sendWorld();
    expect(await runSend(db)).toEqual({
      status: "retry_at",
      at: new Date("2026-10-06T00:01:00.000Z"),
      reason: "resend_daily_quota_exceeded",
    });
    expect(issue).toMatchObject({ status: "sending", resend_broadcast_id: "br_1" });
  });

  it("writes restricted_api_key to send_error and ends dead", async () => {
    provider({ ...SEND_ROUTES, "POST /broadcasts/br_1/send": failure("restricted_api_key", 403) });
    const { db, issue } = sendWorld();
    expect(await outcomeOf(runSend(db))).toEqual({ dead: true, message: "restricted_api_key" });
    expect(issue["send_error"]).toBe("restricted_api_key");
  });

  it("holds 30 recipients with 25 sent today to tomorrow, leaves the issue approved and tells the admin once", async () => {
    const calls = provider(SEND_ROUTES);
    const { db, issue, notices } = sendWorld({ recipients: 30, sentToday: 25 });
    expect(await runSend(db)).toEqual({
      status: "retry_at",
      at: new Date("2026-10-06T00:01:00.000Z"),
      reason: "quota",
    });
    expect(issue["status"]).toBe("approved");
    expect(notices).toEqual([
      {
        params: { headline: "Place Notes No. 7 waits for tomorrow's quota" },
        data: {
          summary: "30 recipients, 25 sent today, bulk cap 50",
          link_path: `/admin/newsletter/${ISSUE_ID}`,
        },
      },
    ]);
    expect(calls).toEqual([]);
  });

  it("refuses 51 recipients as quota_exceeds_plan: send_error, still approved, one notice", async () => {
    const calls = provider(SEND_ROUTES);
    const { db, issue, notices } = sendWorld({ recipients: 51 });
    expect(await outcomeOf(runSend(db))).toEqual({ dead: true, message: "quota_exceeds_plan" });
    expect(issue).toMatchObject({ status: "approved", send_error: "quota_exceeds_plan" });
    expect(notices).toEqual([
      {
        params: { headline: "Place Notes No. 7 exceeds the free sending plan" },
        data: {
          summary: "51 recipients, bulk cap 50; sending needs a paid plan decision",
          link_path: `/admin/newsletter/${ISSUE_ID}`,
        },
      },
    ]);
    expect(calls).toEqual([]);
  });

  it("refuses an issue holding a property unpublished after approval before any create, with one notice", async () => {
    const calls = provider(SEND_ROUTES);
    const { db, issue, notices } = sendWorld({
      issue: { blocks: [storyBlock(1), propertyBlock(2, "Oak Hill")] },
      properties: [propertyRow(2, { slug: "oak-hill", editorial_state: "draft" })],
    });
    expect(await outcomeOf(runSend(db))).toEqual({ dead: true, message: "block_unpublished" });
    expect(issue).toMatchObject({
      status: "approved",
      send_error: `block_unpublished:property:${uuid(2)}`,
    });
    expect(notices).toEqual([
      {
        params: { headline: "Place Notes No. 7 holds an unpublished item" },
        data: { summary: "Oak Hill", link_path: `/admin/newsletter/${ISSUE_ID}` },
      },
    ]);
    expect(calls).toEqual([]);
  });

  it("ends sent with a dry_ broadcast id and no fetch under EMAIL_DRY_RUN=1", async () => {
    emailEnv({ EMAIL_DRY_RUN: "1" });
    const calls = provider({});
    const { db, issue } = sendWorld();
    await runSend(db);
    expect(issue["status"]).toBe("sent");
    expect(String(issue["resend_broadcast_id"])).toMatch(/^dry_/);
    expect(calls).toEqual([]);
  });

  it("newsletter_send runs twice without a second outside effect", async () => {
    let sent = false;
    const calls = provider({
      ...SEND_ROUTES,
      "POST /broadcasts/br_1/send": () => {
        sent = true;
        return { body: { id: "br_1" } };
      },
      "GET /broadcasts/br_1": () => ({ body: { id: "br_1", status: sent ? "sent" : "draft" } }),
    });
    const { db, issue } = sendWorld({ markSentFails: 1 });
    expect(await outcomeOf(runSend(db))).toEqual({
      dead: false,
      message: "newsletter_write_failed:newsletter_mark_sent:XX000",
    });
    expect(await runSend(db)).toEqual({ status: "done", result: { adopted: true } });
    expect(sends(calls)).toHaveLength(1);
    expect(issue["status"]).toBe("sent");
  });
});
