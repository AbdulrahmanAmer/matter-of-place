import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Json } from "../../../src/db";
import { resolveVariables } from "../../../src/server/email/variables";
import type { JsonObject } from "../../../src/server/jobs/types";
import { getStep } from "../../../src/server/jobs/steps/index";
import { sendEmail, sendOne } from "../../../src/server/jobs/steps/send-email";
import { sha256Hex } from "../../../src/server/lib/crypto";
import {
  ADMIN,
  BUILD_SHARE,
  CONTACT,
  emailEnv,
  emailWorld,
  failure,
  fakeFetch,
  FROM,
  FROM_BULK,
  JOB_KEY,
  resendError,
  stepCtx,
  SUBMISSION_ID,
  SUBMISSION_ROW,
  SUBMITTER,
  type World,
} from "../../fixtures/email-send";

// The `send_email` step and `sendOne` with Resend mocked at `fetch` (B5 step 4, invariants 4 to 7 and 16).

// The confirm resolvers open the sealed token only once step 7 lands; the key-choice cases stand in their variables.
vi.mock("../../../src/server/email/variables", { spy: true });

const SUBSCRIBER_ID = "44444444-4444-4444-8444-444444444444";
const INQUIRY_ID = "33333333-3333-4333-8333-333333333333";
const rendered = { subject: "Subject", preheader: "", html: "<p>Body</p>", text: "Body" };

function setup(world: World = {}, answer?: (attempt: number) => Response | undefined) {
  const fetch = fakeFetch(answer);
  const { db, messages, tables } = emailWorld(world);
  const logs: string[] = [];
  const reports: string[][] = [];
  const ctx = stepCtx(db, {
    logs,
    report: (_error, { fingerprint }) => {
      reports.push(fingerprint);
      return Promise.resolve();
    },
  });
  const run = (
    params: Json = { template: "received" },
    data: JsonObject = { submission_id: SUBMISSION_ID },
  ) => sendEmail.run(ctx, params, data);
  return { fetch, db, messages, tables, logs, reports, ctx, run };
}

const atIso = (result: { status: string; at?: Date }) =>
  result.at === undefined ? result : { ...result, at: result.at.toISOString() };

beforeEach(() => {
  emailEnv();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.mocked(resolveVariables).mockClear();
});

describe("send_email", () => {
  it("sends the received email to the submitter and records it sent", async () => {
    const { run, fetch, messages } = setup();
    expect(await run()).toEqual({ status: "done", result: { sent: "re_1" } });
    expect(fetch.requests.map(({ body }) => [body.to, body.subject])).toEqual([
      [[SUBMITTER], "We have your submission"],
    ]);
    expect(messages).toMatchObject([
      {
        to_email: SUBMITTER,
        status: "sent",
        resend_id: "re_1",
        kind: "transactional",
        entity: "submission",
        entity_id: SUBMISSION_ID,
      },
    ]);
  });

  it("skips a suppressed address with a skipped row and no call", async () => {
    const { run, fetch, messages } = setup({ suppressed: [SUBMITTER] });
    expect(await run()).toEqual({ status: "done", result: { skipped: "suppressed" } });
    expect({ calls: fetch.requests.length, rows: messages }).toMatchObject({
      calls: 0,
      rows: [{ status: "skipped", error: "suppressed", sent_at: null }],
    });
  });

  it("skips a disabled template with no row and no call", async () => {
    const { run, fetch, messages } = setup({ templates: { received: { enabled: false } } });
    expect(await run()).toEqual({ status: "done", result: { skipped: "template_disabled" } });
    expect([fetch.requests.length, messages.length]).toEqual([0, 0]);
  });

  it("is dead when a variable of the row has no value", async () => {
    const body = [{ type: "paragraph", text: "{{not_a_variable}}" }, { type: "signature" }];
    const { run, fetch } = setup({ templates: { received: { body } } });
    expect(await failure(run())).toEqual({
      dead: true,
      message: "missing_variable:not_a_variable",
    });
    expect(fetch.requests).toHaveLength(0);
  });

  it("at daily_cap returns retry_at and writes no row", async () => {
    const { run, fetch, messages } = setup({ sentToday: 75 });
    expect(atIso(await run())).toEqual({
      status: "retry_at",
      at: "2026-10-06T00:01:00.000Z",
      reason: "daily_cap",
    });
    expect([fetch.requests.length, messages.length]).toEqual([0, 0]);
  });

  it("priority: a bulk send at bulk_cap waits and a transactional one sends", async () => {
    // `market_open` stands for a bulk template here: `standalone` is one broadcast and never reaches `sendOne`.
    const note = [{ type: "paragraph", text: "Open." }, { type: "signature" }];
    const { run } = setup({
      sentToday: 50,
      notify: [ADMIN],
      templates: { market_open: { subject: "Open", body: note } },
    });
    const bulk = await run(
      { template: "market_open", to: "admins" },
      { submission_id: SUBMISSION_ID },
    );
    const transactional = await run();
    expect([atIso(bulk), transactional]).toEqual([
      { status: "retry_at", at: "2026-10-06T01:00:00.000Z", reason: "daily_cap_bulk" },
      { status: "done", result: { sent: "re_1" } },
    ]);
  });

  it.each([
    {
      name: "rate_limit_exceeded",
      answer: () => resendError(429, "rate_limit_exceeded", { "retry-after": "30" }),
      ends: {
        result: {
          status: "retry_at",
          at: "2026-10-05T14:30:30.000Z",
          reason: "rate_limit_exceeded",
        },
      },
    },
    {
      name: "monthly_quota_exceeded",
      answer: () => resendError(429, "monthly_quota_exceeded"),
      ends: {
        result: {
          status: "retry_at",
          at: "2026-11-01T00:01:00.000Z",
          reason: "monthly_quota_exceeded",
        },
      },
    },
    {
      name: "validation_error",
      answer: () => resendError(403, "validation_error"),
      ends: { thrown: { dead: true, message: "validation_error" } },
    },
    {
      name: "missing_api_key",
      answer: () => resendError(401, "missing_api_key"),
      ends: { thrown: { dead: true, message: "missing_api_key" } },
    },
    {
      name: "application_error",
      answer: () => resendError(500, "application_error"),
      ends: { thrown: { dead: false, message: "resend_application_error" } },
    },
  ])("handles $name as classifyResendError says", async ({ name, answer, ends }) => {
    const { run, messages, reports } = setup({}, answer);
    const pending = run();
    const outcome =
      "thrown" in ends ? { thrown: await failure(pending) } : { result: atIso(await pending) };
    expect(outcome).toEqual(ends);
    expect(messages).toMatchObject([{ status: "failed", error: name }]);
    expect(reports).toEqual(
      name === "monthly_quota_exceeded" ? [["alert", "resend_monthly_quota"]] : [],
    );
  });

  // A first attempt Resend delivered, then a crash before the row was finished, then a retry with other content.
  async function changedRetry() {
    const sent = setup({ finishFails: 1 });
    const first = await failure(sent.run());
    const row = sent.tables["email_templates"]?.find((template) => template["key"] === "received");
    if (row !== undefined) row["subject"] = "Changed subject";
    const second = await sent.run();
    const third = await sent.run();
    return { ...sent, first, second, third };
  }

  it("a retry with changed content keeps the stored content_hash and the Idempotency-Key", async () => {
    const { fetch, messages, logs } = await changedRetry();
    const hash = await sha256Hex(`We have your submission\n${fetch.requests[0]?.body.html ?? ""}`);
    expect(messages.map((row) => row.content_hash)).toEqual([hash]);
    const keys = fetch.requests.map((request) => request.headers.get("idempotency-key"));
    expect(keys).toEqual([keys[0], keys[0]]);
    expect(logs.filter((line) => line.includes("email_content_changed"))).toHaveLength(1);
  });

  it("a 409 invalid_idempotent_request after a delivered first attempt records sent", async () => {
    const { fetch, messages, reports, first, second, third } = await changedRetry();
    expect({ first, second, third }).toEqual({
      first: { dead: false, message: "email_message_finish_failed" },
      second: { status: "done", result: { sent: null } },
      third: { status: "done", result: { already_sent: true } },
    });
    expect(messages).toMatchObject([{ status: "sent", error: "idempotent_conflict" }]);
    expect([fetch.requests.length, fetch.deliveries()]).toEqual([2, 1]);
    expect(reports).toEqual([["email", "idempotent_conflict"]]);
  });

  it("a retry after a crash past Resend's answer sends no second email", async () => {
    const { run, fetch, messages } = setup({ finishFails: 1 });
    await failure(run());
    expect(await run()).toEqual({ status: "done", result: { sent: "re_1" } });
    const key = `${JOB_KEY}:${(await sha256Hex(SUBMITTER)).slice(0, 12)}`;
    expect(fetch.requests.map((request) => request.headers.get("idempotency-key"))).toEqual([
      key,
      key,
    ]);
    expect([fetch.deliveries(), messages[0]?.status]).toEqual([1, "sent"]);
  });

  it("send_email runs twice without a second outside effect", async () => {
    const { run, fetch, messages } = setup();
    await run();
    expect(await run()).toEqual({ status: "done", result: { already_sent: true } });
    expect([fetch.requests.length, messages.length]).toEqual([1, 1]);
  });

  it("tags every send with env and the MOP_ENV of the runner", async () => {
    const { run, fetch } = setup();
    await run();
    expect(fetch.requests[0]?.body.tags).toEqual([{ name: "env", value: "production" }]);
  });

  it("records not_allow_listed with no fetch for a non-listed address on preview", async () => {
    emailEnv({ MOP_ENV: "preview", EMAIL_LIVE: "1" });
    const { run, fetch, messages } = setup({ share: BUILD_SHARE });
    expect(await run()).toEqual({ status: "done", result: { skipped: "not_allow_listed" } });
    expect({ calls: fetch.requests.length, rows: messages }).toMatchObject({
      calls: 0,
      rows: [{ status: "skipped", error: "not_allow_listed" }],
    });
  });

  it("sends the row's subject and body when they differ from its definition", async () => {
    const body = [{ type: "paragraph", text: "Edited body for {{city}}" }, { type: "signature" }];
    const { run, fetch } = setup({
      templates: { received: { subject: "Edited for {{submitter_name}}", body } },
    });
    await run();
    expect(fetch.requests[0]?.body.subject).toBe("Edited for Jordan Lee");
    expect(fetch.requests[0]?.body.html).toContain("Edited body for Pasadena");
  });

  it.each(["e2e+1@fixtures.invalid", "owner@house.test", "owner@house.example"])(
    "reserved domain: %s gets a skipped row and no call",
    async (address) => {
      const { run, fetch, messages } = setup({
        tables: { submissions: [{ ...SUBMISSION_ROW, submitter_email: address }] },
      });
      expect(await run()).toEqual({ status: "done", result: { skipped: "reserved_domain" } });
      expect({ calls: fetch.requests.length, rows: messages }).toMatchObject({
        calls: 0,
        rows: [{ status: "skipped", error: "reserved_domain" }],
      });
    },
  );

  it("sendOne with pre-rendered content and no template row writes one row and one call", async () => {
    const { ctx, db, fetch, messages } = setup();
    const outcome = await sendOne(ctx, {
      to: "reader@gmail.com",
      templateKey: "market_open",
      kind: "bulk",
      rendered,
    });
    expect(outcome).toEqual({ status: "sent", resendId: "re_1" });
    expect([messages.length, fetch.requests.length]).toEqual([1, 1]);
    expect(db.calls.filter((call) => call.name === "email_templates")).toEqual([]);
  });

  it("reply to: the contact address when set, else ADMIN_NOTIFY_EMAIL", async () => {
    const withContact = setup();
    await withContact.run();
    const withoutContact = setup({ contact: null });
    await withoutContact.run();
    expect(
      [withContact, withoutContact].map(({ fetch }) => fetch.requests[0]?.body.reply_to),
    ).toEqual([CONTACT, ADMIN]);
  });

  it("with EMAIL_DRY_RUN=1 makes no fetch and records skipped with a dry_ id", async () => {
    emailEnv({ EMAIL_DRY_RUN: "1" });
    const { run, fetch, messages } = setup();
    expect(await run()).toEqual({ status: "done", result: { skipped: "dry_run" } });
    expect(fetch.requests).toHaveLength(0);
    expect(messages).toMatchObject([{ status: "skipped", error: "dry_run", sent_at: null }]);
    expect(messages[0]?.resend_id).toMatch(/^dry_[0-9a-f-]{36}$/);
  });

  it("is dead with resend_not_configured when a live call has no RESEND_API_KEY", async () => {
    emailEnv({ RESEND_API_KEY: undefined });
    const { run, fetch, messages } = setup();
    expect(await failure(run())).toEqual({ dead: true, message: "resend_not_configured" });
    expect(fetch.requests).toHaveLength(0);
    expect(messages).toMatchObject([{ status: "failed", error: "resend_not_configured" }]);
  });

  it("sender: RESEND_FROM for transactional, alert and test, RESEND_FROM_BULK for bulk", async () => {
    const { ctx, fetch } = setup();
    for (const [index, kind] of (["transactional", "alert", "test", "bulk"] as const).entries()) {
      await sendOne(ctx, {
        to: `reader${String(index)}@gmail.com`,
        templateKey: "x",
        kind,
        rendered,
      });
    }
    expect(fetch.requests.map(({ body }) => body.from)).toEqual([FROM, FROM, FROM, FROM_BULK]);
  });

  it("ends an inquiry_forward with no submitter as no_submitter, with no row and no call", async () => {
    const inquiry = {
      id: INQUIRY_ID,
      name: "Sam Ortiz",
      email: "sam@gmail.com",
      phone: null,
      message: "A general question",
      subject_slug: null,
      anonymised_at: null,
    };
    const { run, fetch, messages } = setup({ tables: { inquiries: [inquiry] } });
    expect(await run({ template: "inquiry_forward" }, { inquiry_id: INQUIRY_ID })).toEqual({
      status: "done",
      result: { skipped: "no_submitter" },
    });
    expect([fetch.requests.length, messages.length]).toEqual([0, 0]);
  });

  it("is reached through B8's getStep for send_email and notify_admin", () => {
    expect([getStep("send_email")?.type, getStep("notify_admin")?.type]).toEqual([
      "send_email",
      "notify_admin",
    ]);
  });
});

describe("send_email picks the confirmation from the subscriber (invariant 7, DL-06)", () => {
  const variables = {
    market_names: "California",
    confirm_url: "https://matterofplace.com/api/public/subscribers/confirm?token=t",
  };

  async function confirmSubject(named: string, markets: string[], pendingSource: string | null) {
    vi.mocked(resolveVariables).mockResolvedValueOnce(variables);
    const subscriber = {
      id: SUBSCRIBER_ID,
      email: "reader@gmail.com",
      markets,
      pending_source: pendingSource,
    };
    const { run, fetch } = setup({ tables: { subscribers: [subscriber] } });
    await run({ template: named }, { subscriber_id: SUBSCRIBER_ID, sealed_token: "sealed" });
    return fetch.requests[0]?.body.subject;
  }

  it("sends newsletter_confirm for interest_confirm when pending_source is set", async () => {
    expect(await confirmSubject("interest_confirm", ["california"], "newsletter")).toBe(
      "Confirm your Place Notes subscription",
    );
  });

  it("sends newsletter_confirm for interest_confirm when markets is empty", async () => {
    expect(await confirmSubject("interest_confirm", [], null)).toBe(
      "Confirm your Place Notes subscription",
    );
  });

  it("sends interest_confirm for newsletter_confirm when the subscriber follows markets", async () => {
    expect(await confirmSubject("newsletter_confirm", ["california"], null)).toBe(
      "Confirm your interest in California",
    );
  });
});
