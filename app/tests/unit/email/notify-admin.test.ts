import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Json } from "../../../src/db";
import type { JsonObject, Reporter } from "../../../src/server/jobs/types";
import { notifyAdmin } from "../../../src/server/jobs/steps/notify-admin";
import { sha256Hex } from "../../../src/server/lib/crypto";
import {
  ADMIN,
  CONTACT,
  emailEnv,
  emailWorld,
  EVENT_ID,
  failure,
  fakeFetch,
  JOB_ID,
  JOB_KEY,
  resendError,
  sentryReporter,
  stepCtx,
  SUBMISSION_ID,
  type World,
} from "../../fixtures/email-send";

// Step `notify_admin` (invariants 4 and 14, INT-04): one row and one Idempotency-Key per admin address, and one
// Sentry report before any send, so an alert is heard while mail is down.

const ADMINS = ["ops@matterofplace.com", "owner@matterofplace.com"];
const data: JsonObject = { submission_id: SUBMISSION_ID };

function setup(
  world: World = {},
  options: { report?: Reporter; event?: boolean; answer?: () => Response } = {},
) {
  const fetch = fakeFetch(options.answer);
  const { db, messages } = emailWorld({ eventType: "submission.received", ...world });
  const logs: string[] = [];
  const ctx = stepCtx(db, {
    logs,
    type: "notify_admin",
    eventId: options.event === false ? null : EVENT_ID,
    ...(options.report === undefined ? {} : { report: options.report }),
  });
  const run = (params: Json = {}, payload = data) => notifyAdmin.run(ctx, params, payload);
  return { fetch, messages, logs, run };
}

beforeEach(() => {
  emailEnv();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("notify_admin", () => {
  it("makes one Sentry report with the alert fingerprint while Resend fails", async () => {
    const { run, fetch } = setup(
      { notify: ADMINS },
      { report: sentryReporter, answer: () => resendError(500, "application_error") },
    );
    expect(await failure(run())).toEqual({ dead: false, message: "resend_application_error" });
    expect(fetch.envelopes.map((envelope) => [envelope.level, envelope.fingerprint])).toEqual([
      ["warning", ["alert", "submission.received"]],
    ]);
  });

  it("reports a job no event made under its key up to the second colon", async () => {
    const { run, fetch } = setup(
      { jobKey: "health:2026-10-05:checks", eventType: "unused" },
      { report: sentryReporter, event: false },
    );
    await run(
      { headline: "Checks failed" },
      { summary: "Two checks failed", link_path: "/admin/jobs" },
    );
    expect(fetch.envelopes.map((envelope) => envelope.fingerprint)).toEqual([
      ["alert", "health:2026-10-05"],
    ]);
  });

  it("writes one alert row and one distinct Idempotency-Key per admin address", async () => {
    const { run, fetch, messages } = setup({ notify: ADMINS });
    await run();
    const keys = await Promise.all(
      ADMINS.map(async (address) => `${JOB_KEY}:${(await sha256Hex(address)).slice(0, 12)}`),
    );
    expect(fetch.requests.map((request) => request.headers.get("idempotency-key"))).toEqual(keys);
    expect(messages.map((row) => [row.to_email, row.kind, row.status])).toEqual([
      [ADMINS[0], "alert", "sent"],
      [ADMINS[1], "alert", "sent"],
    ]);
  });

  it.each([
    { name: "the notification list", world: { notify: ADMINS }, to: ADMINS },
    { name: "then the contact address", world: {}, to: [CONTACT] },
    { name: "then ADMIN_NOTIFY_EMAIL", world: { contact: null }, to: [ADMIN] },
  ])("sends to $name", async ({ world, to }) => {
    const { run, fetch } = setup(world);
    await run();
    expect(fetch.requests.flatMap((request) => request.body.to)).toEqual(to);
  });

  it("replaces the variables of a headline given as a parameter", async () => {
    const { run, fetch } = setup();
    await run({ headline: "Seen: {{summary}}" });
    expect(fetch.requests[0]?.body.subject).toBe(
      "Seen: New request: 412 Alder Court, Pasadena, California",
    );
  });

  it("notify_admin runs twice without a second outside effect", async () => {
    const { run, fetch, messages } = setup({ notify: ADMINS });
    await run();
    expect(await run()).toEqual({
      status: "done",
      result: { messages: [{ already_sent: true }, { already_sent: true }] },
    });
    expect([fetch.requests.length, messages.length]).toEqual([2, 2]);
  });

  it("logs a failed Sentry report and still sends", async () => {
    const { run, fetch, logs } = setup(
      {},
      { report: () => Promise.reject(new Error("sentry down")) },
    );
    expect(await run()).toEqual({ status: "done", result: { sent: "re_1" } });
    expect(fetch.requests).toHaveLength(1);
    expect(logs).toEqual([
      JSON.stringify({ level: "warn", event: "alert_report_failed", jobId: JOB_ID }),
    ]);
  });
});
