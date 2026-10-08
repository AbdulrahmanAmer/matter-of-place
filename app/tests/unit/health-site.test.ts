// B16 step 8: the `site_identity` entry of the daily health job. The database is a `countingDb` over B3's fakeDb that
// answers `public_state` with the site each case sets, so the cases also count the reads the check makes.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { Json } from "../../src/db";
import { healthChecks, health, type HealthContext } from "../../src/server/jobs/system/health";
import { logLine } from "../../src/server/lib/log";
import { resetPublicStateMemo } from "../../src/server/public/state";
import { countingDb, type CountingDb } from "../fixtures/db-counter";
import { fakeDb } from "../fixtures/fake-db";
import { stateJson } from "../fixtures/snapshot";

vi.mock(import("../../src/server/public/state"), async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, resetPublicStateMemo: vi.fn(actual.resetPublicStateMemo) };
});

const SET_SITE: Json = {
  contact: { email: "hello@example.test", phone: null, privacy_email: null },
  legal: { entity: "Example Test LLC", address: "1 Test Street, Testville, CA 90000" },
  social: { instagram: null, x: null, linkedin: null },
};
const EMPTY_SITE: Json = {};

const entry = healthChecks.find((check) => check.name === "site_identity");
if (entry === undefined) throw new Error("healthChecks has no site_identity entry");

const resultSchema = z.object({
  checks: z.array(z.object({ name: z.string(), status: z.string(), message: z.string() })),
});

let answer: Json | Error;

// The provider checks of the full job read `settings.linkedin` with one filtered select, which fakeDb does not answer.
const siteDb = (): CountingDb => {
  const db = fakeDb({
    rpc: {
      public_state: () => answer,
      health_counts: () => ({
        dead_jobs_24h: 0,
        stale_queue: 0,
        retention_stalled: [],
        long_waits: 0,
        local_oldest_age_s: null,
        backup: null,
      }),
      health_cron_failures: () => 0,
      emit_event: () => "5b0c7c4e-0000-4000-8000-000000000009",
    },
  });
  return countingDb(
    Object.assign(db, {
      from: (name: string) => {
        db.calls.push({ kind: "from", name, args: [] });
        return {
          select: () => ({
            eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }),
          }),
        };
      },
    }),
  );
};

const context = (db: CountingDb, env: Record<string, string | undefined>): HealthContext => ({
  db,
  env,
  log: logLine,
  now: new Date("2026-10-04T13:00:00.000Z"),
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
  counts: () => Promise.reject(new Error("site_identity reads no counts")),
});

const check = (db: CountingDb, env: Record<string, string | undefined> = {}) =>
  entry.run(context(db, env));

beforeEach(() => {
  vi.mocked(resetPublicStateMemo).mockClear();
  answer = stateJson(7, { site: EMPTY_SITE });
});

describe("site_identity", () => {
  it("fails with the missing required fields when MOP_ENV is production or unset", async () => {
    const message = "settings.site is missing: contact.email, legal.entity, legal.address";
    expect(await check(siteDb(), { MOP_ENV: "production" })).toEqual({ status: "fail", message });
    expect(await check(siteDb(), {})).toEqual({ status: "fail", message });
    expect(await check(siteDb(), { MOP_ENV: "staging" })).toMatchObject({ status: "fail" });
  });

  it("warns when MOP_ENV is development or preview", async () => {
    expect(await check(siteDb(), { MOP_ENV: "development" })).toMatchObject({ status: "warn" });
    expect(await check(siteDb(), { MOP_ENV: "preview" })).toMatchObject({ status: "warn" });
  });

  it("is ok when every required field is set, in any environment, with one state read", async () => {
    answer = stateJson(7, { site: SET_SITE });
    const db = siteDb();
    expect((await check(db, { MOP_ENV: "production" })).status).toBe("ok");
    expect(db.counts).toEqual({ rpc: { public_state: 1 }, from: {}, storage: {}, total: 1 });
  });

  it("fails with public_state_stale when the database stops answering after a good read", async () => {
    answer = stateJson(7, { site: SET_SITE });
    const db = siteDb();
    expect((await check(db, { MOP_ENV: "development" })).status).toBe("ok");
    answer = new Error("connection refused");
    expect(await check(db, { MOP_ENV: "development" })).toEqual({
      status: "fail",
      message: "public_state_stale",
    });
  });

  it("fails with the error code when the database does not answer and there is no last good copy", async () => {
    // The memo lives in the module, so a cold isolate is a fresh import.
    vi.doUnmock("../../src/server/public/state");
    vi.resetModules();
    const cold = await import("../../src/server/jobs/system/health");
    const coldEntry = cold.healthChecks.find((candidate) => candidate.name === "site_identity");
    answer = new Error("connection refused");
    expect(await coldEntry?.run(context(siteDb(), { MOP_ENV: "development" }))).toEqual({
      status: "fail",
      message: "unavailable",
    });
  });

  it("drops the memo once per run", async () => {
    answer = stateJson(7, { site: SET_SITE });
    const db = siteDb();
    await check(db);
    expect(resetPublicStateMemo).toHaveBeenCalledTimes(1);
    await check(db);
    expect(resetPublicStateMemo).toHaveBeenCalledTimes(2);
    expect(db.counts.rpc["public_state"]).toBe(2);
  });
});

describe("the health job with a site that is not set", () => {
  it("lists site_identity as a failed check in production and emits health.failed", async () => {
    const db = siteDb();
    const result = await health.run(context(db, { MOP_ENV: "production" }), {}, {});
    if (result.status !== "done") throw new Error(`health ended ${result.status}`);
    const { checks } = resultSchema.parse(result.result);
    expect(checks).toContainEqual({
      name: "site_identity",
      status: "fail",
      message: "settings.site is missing: contact.email, legal.entity, legal.address",
    });
    expect(db.counts.rpc["emit_event"]).toBe(1);
  });
});
