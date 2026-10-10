import { describe, expect, it } from "vitest";
import type { Json } from "../../../src/db";
import { P009_LIMITS } from "../../../src/server/audit/gauges";
import { healthChecks, type HealthContext } from "../../../src/server/jobs/system/health";
import { logLine } from "../../../src/server/lib/log";
import { fakeDb } from "../../fixtures/fake-db";

// B14 step 5, GS-06: the `usage_gauges` entry of the daily health job is the 70 percent alarm, because the vendors mail
// at thresholds of their own. The database is B3's fakeDb with the one `audit_usage` answer each case sets.
const entry = healthChecks.find((check) => check.name === "usage_gauges");
if (entry === undefined) throw new Error("healthChecks has no usage_gauges entry");

const limitOf = (line: string): number => {
  const found = P009_LIMITS.find((candidate) => candidate.line === line)?.limit;
  if (found === null || found === undefined) throw new Error(`no limit for ${line}`);
  return found;
};

const quiet = {
  db_bytes: 0,
  storage_bytes: 0,
  email_sent_today: 0,
  email_sent_month: 0,
  subscribers_confirmed: 0,
};

function run(usage: Json) {
  const db = fakeDb({ rpc: { audit_usage: () => usage } });
  const ctx: HealthContext = {
    db,
    env: {},
    log: logLine,
    now: new Date("2026-10-10T05:00:00.000Z"),
    signal: new AbortController().signal,
    report: () => Promise.resolve(),
    job: {
      id: "3f2a9c1d-0000-4000-8000-000000000001",
      type: "health",
      attempts: 0,
      claim: "7d1e0c52-0000-4000-8000-000000000002",
      result: null,
      eventId: null,
    },
    counts: () => Promise.reject(new Error("usage_gauges reads no counts")),
  };
  return entry?.run(ctx);
}

describe("usage_gauges", () => {
  it("fails with a gauge at 71 percent and names the line", async () => {
    const outcome = await run({ ...quiet, db_bytes: Math.ceil(limitOf("db_bytes") * 0.71) });
    expect(outcome?.status).toBe("fail");
    expect(outcome?.message).toContain("db_bytes at 71 percent");
    expect(outcome?.message).not.toContain("storage_bytes");
  });

  it("passes with the same gauge at 69 percent", async () => {
    const outcome = await run({ ...quiet, db_bytes: Math.floor(limitOf("db_bytes") * 0.69) });
    expect(outcome).toEqual({ status: "ok", message: "every line is under 70 percent" });
  });

  it("fails at exactly 70 percent, the DECISION line, and at 90 percent", async () => {
    const seventy = await run({ ...quiet, email_sent_month: limitOf("email_sent_month") * 0.7 });
    expect(seventy?.status).toBe("fail");
    const ninety = await run({ ...quiet, storage_bytes: limitOf("storage_bytes") * 0.9 });
    expect(ninety?.message).toContain("storage_bytes at 90 percent");
  });

  it("names every line that is over, and reads resend_contacts from subscribers_confirmed", async () => {
    const outcome = await run({
      ...quiet,
      email_sent_today: limitOf("email_sent_today"),
      subscribers_confirmed: limitOf("resend_contacts") * 0.8,
    });
    expect(outcome?.status).toBe("fail");
    expect(outcome?.message).toContain("email_sent_today at 100 percent");
    expect(outcome?.message).toContain("resend_contacts at 80 percent");
  });
});
