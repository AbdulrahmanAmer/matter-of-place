import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SendKind } from "../../../src/server/email/resend-client";
import { sendOne } from "../../../src/server/jobs/steps/send-email";
import { emailEnv, emailWorld, fakeFetch, stepCtx, type World } from "../../fixtures/email-send";

// Invariant 5 (PERF-11): the ceilings by class on the production share, `email_sent_today()` and `email_sent_month()`
// stubbed. A ceiling answers `retry_at`, writes no message row and makes no call.

const rendered = { subject: "Subject", preheader: "", html: "<p>Body</p>", text: "Body" };

async function send(world: World, kind: SendKind, templateKey: string) {
  const fetch = fakeFetch();
  const { db, messages } = emailWorld(world);
  const outcome = await sendOne(stepCtx(db), {
    to: "reader@gmail.com",
    templateKey,
    kind,
    rendered,
  });
  const plain =
    outcome.status === "retry_at" ? { ...outcome, at: outcome.at.toISOString() } : outcome;
  return { outcome: plain, calls: fetch.requests.length, rows: messages.length };
}

beforeEach(() => {
  emailEnv();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("sendOne ceilings by class", () => {
  it("at 50 a bulk send waits until 01:00 UTC with daily_cap_bulk", async () => {
    expect(await send({ sentToday: 50 }, "bulk", "market_open")).toEqual({
      outcome: { status: "retry_at", at: "2026-10-06T01:00:00.000Z", reason: "daily_cap_bulk" },
      calls: 0,
      rows: 0,
    });
  });

  it("at 49 a bulk send still goes out", async () => {
    expect(await send({ sentToday: 49 }, "bulk", "market_open")).toMatchObject({ calls: 1 });
  });

  it("at 50 an invoice send goes out", async () => {
    expect(await send({ sentToday: 50 }, "transactional", "invoice")).toEqual({
      outcome: { status: "sent", resendId: "re_1" },
      calls: 1,
      rows: 1,
    });
  });

  it("at 75 an inquiry_ack waits until 00:01 UTC with daily_cap", async () => {
    expect(await send({ sentToday: 75 }, "transactional", "inquiry_ack")).toEqual({
      outcome: { status: "retry_at", at: "2026-10-06T00:01:00.000Z", reason: "daily_cap" },
      calls: 0,
      rows: 0,
    });
  });

  it("at 75 a test send waits like a transactional one", async () => {
    expect(await send({ sentToday: 75 }, "test", "received")).toMatchObject({
      outcome: { status: "retry_at", reason: "daily_cap" },
    });
  });

  it("at 75 a notify_admin alert still calls Resend", async () => {
    expect(await send({ sentToday: 75 }, "alert", "admin_notify")).toEqual({
      outcome: { status: "sent", resendId: "re_1" },
      calls: 1,
      rows: 1,
    });
  });

  it("at monthly_cap a transactional send waits for the 1st at 00:01", async () => {
    expect(await send({ sentToday: 3, sentMonth: 2600 }, "transactional", "received")).toEqual({
      outcome: { status: "retry_at", at: "2026-11-01T00:01:00.000Z", reason: "monthly_cap" },
      calls: 0,
      rows: 0,
    });
  });

  it("at monthly_cap an alert still calls Resend", async () => {
    expect(await send({ sentMonth: 2600 }, "alert", "admin_notify")).toMatchObject({ calls: 1 });
  });
});
