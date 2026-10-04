// B8 step 8: the prune handler (architecture 13 rule 8, G16). The SQL it calls is proved by retention.db.test.ts;
// these cases prove which calls the handler makes, with which period, and what it stores.
import { describe, expect, it } from "vitest";
import type { Json } from "../../../src/db";
import { prune } from "../../../src/server/jobs/system/prune";
import type { StepContext } from "../../../src/server/jobs/types";
import { logLine } from "../../../src/server/lib/log";
import { fakeDb, type FakeDb } from "../../fixtures/fake-db";

const NOW = new Date("2026-10-04T03:30:00.000Z");

function setup(jobsDone: { keep_for: string | null; enabled: boolean } | null): FakeDb {
  const db = fakeDb({
    rpc: {
      prune_jobs: () => 4,
      retention_delete_rows: ({ p_key }) => (p_key === "rate_limits" ? 7 : 2),
    },
  });
  const rows = jobsDone === null ? [] : [{ key: "jobs_done", action: "delete", ...jobsDone }];
  return Object.assign(db, {
    from: (name: string) => {
      db.calls.push({ kind: "from", name, args: [] });
      return { select: () => ({ in: () => Promise.resolve({ data: rows, error: null }) }) };
    },
  });
}

function context(db: FakeDb): StepContext {
  return {
    db,
    env: {},
    log: logLine,
    now: NOW,
    signal: new AbortController().signal,
    report: () => Promise.resolve(),
    job: {
      id: "3f2a9c1d-0000-4000-8000-000000000001",
      type: "prune",
      attempts: 0,
      claim: "7d1e0c52-0000-4000-8000-000000000002",
      result: null,
      eventId: null,
    },
  };
}

const rpcCalls = (db: FakeDb) =>
  db.calls.filter((call) => call.kind === "rpc").map((call) => [call.name, call.args[0]]);

async function run(db: FakeDb, params: Json = {}) {
  return prune.run(context(db), params, {});
}

describe("prune", () => {
  it("prunes jobs with the jobs_done period, then rate_limits and webhook_receipts, and stores the counts", async () => {
    const db = setup({ keep_for: "30 days", enabled: true });
    const result = await run(db);
    expect(rpcCalls(db)).toEqual([
      ["prune_jobs", { p_keep: "30 days", p_dry_run: false }],
      ["retention_delete_rows", { p_key: "rate_limits", p_dry_run: false }],
      ["retention_delete_rows", { p_key: "webhook_receipts", p_dry_run: false }],
    ]);
    expect(result).toEqual({
      status: "done",
      result: { dry_run: false, jobs_done: 4, rate_limits: 7, webhook_receipts: 2 },
    });
  });

  it("params.dry_run passes p_dry_run to every call", async () => {
    const db = setup({ keep_for: "30 days", enabled: true });
    await run(db, { dry_run: true });
    expect(rpcCalls(db).map(([, args]) => args)).toEqual([
      { p_keep: "30 days", p_dry_run: true },
      { p_key: "rate_limits", p_dry_run: true },
      { p_key: "webhook_receipts", p_dry_run: true },
    ]);
  });

  it("leaves jobs alone while the jobs_done row is absent or disabled", async () => {
    for (const row of [null, { keep_for: "30 days", enabled: false }]) {
      const db = setup(row);
      await run(db);
      expect(rpcCalls(db).map(([name]) => name)).toEqual([
        "retention_delete_rows",
        "retention_delete_rows",
      ]);
    }
  });
});
