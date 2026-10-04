// B8 step 8a: the retention handler (GD-03, G16, G43, PERF-08) and the audit-note row. The SQL each call runs is
// proved by retention.db.test.ts; these cases prove the order of the calls, the Storage removals and the audit row.
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { auditNoteRow } from "../../../scripts/audit-note";
import type { Json } from "../../../src/db";
import { retention } from "../../../src/server/jobs/system/retention";
import type { StepContext } from "../../../src/server/jobs/types";
import { AppError } from "../../../src/server/lib/errors";
import { logLine } from "../../../src/server/lib/log";
import { fakeDb, type FakeDb } from "../../fixtures/fake-db";

const NOW = new Date("2026-10-04T03:45:00.000Z");
const SUBMISSION = "5b0c7c4e-0000-4000-8000-000000000001";

const ALL_KEYS = [
  "declined_submission_media",
  "accepted_submission_media",
  "inquiries_anonymise",
  "contacts_anonymise",
  "analytics_events",
  "analytics_daily",
  "subject_requests",
  "jobs_dead",
  "events_processed",
  "email_pii",
  "unconfirmed_subscribers",
  "cron_history",
  "job_wait_events",
];

const mediaRow = (n: number) => {
  const id = `3f2a9c1d-0000-4000-8000-${String(n).padStart(12, "0")}`;
  return { media_id: id, storage_path: `${SUBMISSION}/${id}.jpg` };
};

interface Setup {
  keys?: string[];
  declined?: number;
  storageFails?: boolean;
}

/** The declined list empties once its rows are deleted, as the database would answer it. */
function setup({ keys = ALL_KEYS, declined = 0, storageFails = false }: Setup = {}): FakeDb {
  let waiting = Array.from({ length: declined }, (_, n) => mediaRow(n));
  const db = fakeDb({
    rpc: {
      rollup_analytics_daily: () => 6,
      retention_declined_media: () => waiting,
      retention_accepted_media: () => [],
      retention_delete_media: ({ p_ids }) => {
        waiting = waiting.filter((row) => !p_ids.includes(row.media_id));
        return p_ids.length;
      },
      retention_anonymise_inquiries: ({ p_dry_run }) => (p_dry_run === true ? 0 : 2),
      retention_anonymise_contacts: () => 0,
      retention_drop_analytics: () => 1,
      retention_delete_rows: ({ p_dry_run }) => (p_dry_run === true ? 0 : 3),
      retention_anonymise_email: () => 0,
      retention_log_run: () => 41,
    },
    storage: {
      submissions: {
        remove: () =>
          Promise.resolve(
            storageFails
              ? { data: null, error: new Error("storage down") }
              : { data: [], error: null },
          ),
      },
    },
  });
  const rows = keys.map((key) => ({ key, keep_for: "90 days", action: "delete", enabled: true }));
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
      id: "3f2a9c1d-0000-4000-8000-000000000009",
      type: "retention",
      attempts: 0,
      claim: "7d1e0c52-0000-4000-8000-000000000002",
      result: null,
      eventId: null,
    },
  };
}

const run = (db: FakeDb, params: Json = {}) => retention.run(context(db), params, {});

const calls = (db: FakeDb, kind: "rpc" | "storage", name?: string) =>
  db.calls
    .filter((call) => call.kind === kind && (name === undefined || call.name === name))
    .map((call) => call.args);

const argsSchema = z
  .object({
    p_key: z.string().optional(),
    p_dry_run: z.boolean().optional(),
    p_ids: z.array(z.string()).optional(),
    p_after: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

/** The parsed arguments of every rpc call, with its name. */
const rpcCalls = (db: FakeDb) =>
  db.calls
    .filter((call) => call.kind === "rpc")
    .map((call) => ({ name: call.name, ...argsSchema.parse(call.args[0] ?? {}) }));

const rpcNames = (db: FakeDb) =>
  db.calls.filter((call) => call.kind === "rpc").map((call) => call.name);

describe("retention", () => {
  it("removes each original with its thumbnail in batches of 100, then deletes only those rows", async () => {
    const db = setup({ keys: ["declined_submission_media"], declined: 150 });
    await run(db);
    const removed = calls(db, "storage", "submissions.remove").map(([paths]) => paths);
    expect(removed.map((paths) => (Array.isArray(paths) ? paths.length : 0))).toEqual([200, 100]);
    expect(removed[0]).toEqual(
      expect.arrayContaining([
        `${SUBMISSION}/${mediaRow(0).media_id}.jpg`,
        `${SUBMISSION}/${mediaRow(0).media_id}.thumb.jpg`,
      ]),
    );
    expect(
      rpcCalls(db)
        .filter((call) => call.name === "retention_delete_media")
        .map((call) => call.p_ids),
    ).toEqual([
      Array.from({ length: 100 }, (_, n) => mediaRow(n).media_id),
      Array.from({ length: 50 }, (_, n) => mediaRow(n + 100).media_id),
    ]);
  });

  it("with the Storage client failing, the rows survive and the job throws", async () => {
    const db = setup({ keys: ["declined_submission_media"], declined: 3, storageFails: true });
    const outcome = await run(db).then(
      () => null,
      (error: unknown) => (error instanceof AppError ? error.code : String(error)),
    );
    expect(outcome).toBe("storage_unavailable");
    expect(calls(db, "rpc", "retention_delete_media")).toEqual([]);
    expect(calls(db, "rpc", "retention_log_run")).toEqual([]);
  });

  it("runs the policies in order after the rollup and writes one audit row with affected and remaining", async () => {
    const db = setup();
    const result = await run(db);
    const realRuns = rpcCalls(db)
      .filter((call) => call.p_dry_run !== true)
      .map((call) => (call.p_key === undefined ? call.name : `${call.name}:${call.p_key}`));
    expect(realRuns).toEqual([
      "rollup_analytics_daily",
      "retention_declined_media",
      "retention_declined_media",
      "retention_accepted_media",
      "retention_accepted_media",
      "retention_anonymise_inquiries",
      "retention_anonymise_contacts",
      "retention_drop_analytics",
      "retention_delete_rows:analytics_daily",
      "retention_delete_rows:subject_requests",
      "retention_delete_rows:jobs_dead",
      "retention_delete_rows:events_processed",
      "retention_anonymise_email",
      "retention_delete_rows:unconfirmed_subscribers",
      "retention_delete_rows:cron_history",
      "retention_delete_rows:job_wait_events",
      "retention_log_run",
    ]);
    const logged = rpcCalls(db)
      .filter((call) => call.name === "retention_log_run")
      .map((call) => call.p_after);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({
      inquiries_anonymise: { affected: 2, remaining: 0 },
      jobs_dead: { affected: 3, remaining: 0 },
      analytics_events: { affected: 1, remaining: 1 },
    });
    expect(Object.keys(logged[0] ?? {}).sort()).toEqual([...ALL_KEYS].sort());
    expect(result.status).toBe("done");
  });

  it("a dry run passes p_dry_run everywhere, removes nothing and writes no audit row", async () => {
    const db = setup({ declined: 2 });
    await run(db, { dry_run: true });
    expect(calls(db, "storage")).toEqual([]);
    expect(rpcNames(db)).not.toContain("retention_log_run");
    expect(rpcNames(db)).not.toContain("rollup_analytics_daily");
    expect(rpcNames(db)).not.toContain("retention_delete_media");
    const dryFlags = rpcCalls(db)
      .map((call) => call.p_dry_run)
      .filter((flag) => flag !== undefined);
    expect(dryFlags.length).toBeGreaterThan(5);
    expect(dryFlags.every(Boolean)).toBe(true);
  });

  it("runs only the policies whose row is enabled with a period", async () => {
    const db = setup({ keys: ["jobs_dead"] });
    await run(db);
    expect(rpcNames(db)).toEqual([
      "rollup_analytics_daily",
      "retention_delete_rows",
      "retention_delete_rows",
      "retention_log_run",
    ]);
  });

  it("rolls up the day before yesterday through yesterday, UTC", async () => {
    const db = setup({ keys: [] });
    await run(db);
    expect(calls(db, "rpc", "rollup_analytics_daily")).toEqual([
      [{ p_from: "2026-10-02", p_to: "2026-10-03" }],
    ]);
  });
});

describe("auditNoteRow", () => {
  it("is the secret.rotated row of the named secret with no actor", () => {
    expect(auditNoteRow({ secret: "TEST_SECRET", note: "test" })).toEqual({
      action: "secret.rotated",
      entity: "TEST_SECRET",
      note: "test",
      actor_id: null,
      actor_kind: null,
    });
  });
});
