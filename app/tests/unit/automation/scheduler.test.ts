import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database, Json } from "../../../src/db";
import { runDueSchedules } from "../../../src/server/jobs/scheduler";
import { fakeDb, type FakeDb } from "../../fixtures/fake-db";

type Row = Database["public"]["Tables"]["schedule_settings"]["Row"];
type ClaimArgs = Database["public"]["Functions"]["claim_schedule"]["Args"];

interface Enqueued {
  type: string;
  key: string;
  data: Json;
}

function schedule(key: string, overrides: Partial<Row> = {}): Row {
  return {
    id: `0b1c2d3e-0000-4000-8000-${String(key.length).padStart(12, "0")}`,
    key,
    cron: "*/15 * * * *",
    interval_days: null,
    enabled: true,
    last_run_at: null,
    next_run_at: null,
    created_at: "2026-10-01T00:00:00.000Z",
    updated_at: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

interface Setup {
  db: FakeDb;
  rows: Row[];
  jobs: Enqueued[];
  emitted: Json[];
}

function setup(
  rows: Row[],
  fail: { claim?: boolean; emit?: boolean; enqueue?: boolean } = {},
): Setup {
  const jobs: Enqueued[] = [];
  const emitted: Json[] = [];
  // claim_schedule as its SQL: the guard compares the stored last_run_at, a switched-off row is never claimed.
  const claim = (args: ClaimArgs): boolean | Error => {
    if (fail.claim === true) return new Error("claim failed");
    const row = rows.find((candidate) => candidate.key === args.p_key);
    if (row === undefined || !row.enabled) return false;
    if (args.p_guard && row.last_run_at !== (args.p_old_last_run_at ?? null)) return false;
    row.last_run_at = args.p_last_run_at ?? null;
    row.next_run_at = args.p_next_run_at ?? null;
    return true;
  };
  const db = fakeDb({
    tables: { schedule_settings: rows },
    rpc: {
      claim_schedule: claim,
      emit_event: (args) => {
        if (fail.emit === true) return new Error("emit failed");
        emitted.push({ type: args.p_type, entity: args.p_entity, payload: args.p_payload ?? null });
        return "5e6f7a8b-0000-4000-8000-000000000001";
      },
      enqueue_job: (args) => {
        if (fail.enqueue === true) return new Error("enqueue failed");
        const payload = args.p_payload;
        const data =
          typeof payload === "object" && payload !== null && !Array.isArray(payload)
            ? (payload["data"] ?? null)
            : null;
        jobs.push({ type: args.p_type, key: args.p_idempotency_key, data });
        return "5e6f7a8b-0000-4000-8000-000000000002";
      },
    },
  });
  return { db, rows, jobs, emitted };
}

let lines: string[] = [];

beforeEach(() => {
  lines = [];
  const capture = (line: string) => {
    lines.push(line);
  };
  vi.spyOn(console, "log").mockImplementation(capture);
  vi.spyOn(console, "warn").mockImplementation(capture);
  vi.spyOn(console, "error").mockImplementation(capture);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const logged = (event: string) =>
  lines
    .map((line) => JSON.parse(line) as unknown)
    .filter((line) => {
      return typeof line === "object" && line !== null && Reflect.get(line, "event") === event;
    });

const rpcCount = (db: FakeDb, name: string) =>
  db.calls.filter((call) => call.kind === "rpc" && call.name === name).length;

describe("runDueSchedules (invariant 11)", () => {
  it("a due digest emits digest.due once, and a second call in the same tick emits nothing", async () => {
    const now = new Date("2026-10-27T14:00:05.000Z");
    const { db, emitted, rows } = setup([
      schedule("digest", {
        cron: "0 14 * * 2",
        interval_days: 14,
        last_run_at: "2026-10-07T10:00:00.000Z",
      }),
    ]);
    expect(await runDueSchedules(db, now)).toBe(1);
    expect(await runDueSchedules(db, now)).toBe(0);
    expect(emitted).toEqual([
      { type: "digest.due", entity: "system", payload: { scheduled_for: now.toISOString() } },
    ]);
    expect(rows[0]?.last_run_at).toBe(now.toISOString());
    expect(rows[0]?.next_run_at).toBe("2026-11-10T14:00:00.000Z");
  });

  it("emit_event gets no p_entity_id for the system digest", async () => {
    const { db } = setup([schedule("digest", { next_run_at: "2026-10-27T14:00:00.000Z" })]);
    await runDueSchedules(db, new Date("2026-10-27T14:00:05.000Z"));
    const emit = db.calls.find((call) => call.name === "emit_event");
    expect(emit?.args[0]).not.toHaveProperty("p_entity_id");
  });

  it("prune enqueues the key prune:<UTC date>", async () => {
    const { db, jobs } = setup([
      schedule("prune", { cron: "30 3 * * *", next_run_at: "2026-10-05T03:30:00.000Z" }),
    ]);
    await runDueSchedules(db, new Date("2026-10-05T03:30:20.000Z"));
    expect(jobs).toEqual([{ type: "prune", key: "prune:2026-10-05", data: {} }]);
  });

  it("a due reconcile at 10:15 enqueues one job with data.since, and a second call none", async () => {
    const now = new Date("2026-10-04T10:15:40.000Z");
    const { db, jobs } = setup([
      schedule("reconcile", { last_run_at: "2026-10-04T10:00:03.123Z" }),
    ]);
    await runDueSchedules(db, now);
    await runDueSchedules(db, now);
    expect(jobs).toEqual([
      {
        type: "reconcile",
        key: "reconcile:2026-10-04T10:15",
        data: { since: "2026-10-04T10:00:03.123Z" },
      },
    ]);
  });

  it("a reconcile that never ran and a late tick key the quarter hour, with empty data", async () => {
    const { db, jobs } = setup([
      schedule("reconcile", { next_run_at: "2026-10-04T10:15:00.000Z" }),
    ]);
    await runDueSchedules(db, new Date("2026-10-04T10:18:00.000Z"));
    expect(jobs).toEqual([{ type: "reconcile", key: "reconcile:2026-10-04T10:15", data: {} }]);
  });

  it.each(["kpi_weekly", "newsletter_hygiene"])(
    "a due %s enqueues <key>:<UTC date>",
    async (key) => {
      const { db, jobs } = setup([schedule(key, { next_run_at: "2026-10-10T15:00:00.000Z" })]);
      await runDueSchedules(db, new Date("2026-10-10T15:00:10.000Z"));
      expect(jobs).toEqual([{ type: key, key: `${key}:2026-10-10`, data: {} }]);
    },
  );

  it.each(["kpi_weekly", "newsletter_hygiene"])(
    "a due %s fires once and moves both of its clocks",
    async (key) => {
      const now = new Date("2026-10-10T15:00:10.000Z");
      const { db, jobs, rows } = setup([
        schedule(key, {
          cron: "0 15 * * 6",
          last_run_at: "2026-10-03T15:00:00.000Z",
          next_run_at: "2026-10-10T15:00:00.000Z",
        }),
      ]);
      await runDueSchedules(db, now);
      await runDueSchedules(db, now);
      expect(jobs.map((job) => job.key)).toEqual([`${key}:2026-10-10`]);
      expect(rows[0]?.last_run_at).toBe(now.toISOString());
      expect(rows[0]?.next_run_at).toBe("2026-10-17T15:00:00.000Z");
    },
  );

  it("a throwing emit puts last_run_at back and logs schedule_failed", async () => {
    const last = "2026-10-07T10:00:00.000Z";
    const { db, rows } = setup(
      [schedule("digest", { cron: "0 14 * * 2", interval_days: 14, last_run_at: last })],
      { emit: true },
    );
    expect(await runDueSchedules(db, new Date("2026-10-27T14:00:05.000Z"))).toBe(0);
    expect(rows[0]?.last_run_at).toBe(last);
    expect(rows[0]?.next_run_at).toBeNull();
    expect(rpcCount(db, "claim_schedule")).toBe(2);
    expect(logged("schedule_failed")).toEqual([
      { level: "error", event: "schedule_failed", key: "digest" },
    ]);
  });

  it("a throwing enqueue is retried by the next tick", async () => {
    const now = new Date("2026-10-04T10:15:40.000Z");
    const rows = [schedule("reconcile", { last_run_at: "2026-10-04T10:00:00.000Z" })];
    await runDueSchedules(setup(rows, { enqueue: true }).db, now);
    const retry = setup(rows);
    await runDueSchedules(retry.db, now);
    expect(retry.jobs.map((job) => job.key)).toEqual(["reconcile:2026-10-04T10:15"]);
  });

  it("a rollback that finds the row switched off logs schedule_rollback_missed", async () => {
    const rows = [schedule("prune", { next_run_at: "2026-10-05T03:30:00.000Z" })];
    const { db } = setup(rows, { enqueue: true });
    const original = db.rpc.bind(db);
    vi.spyOn(db, "rpc").mockImplementation((name, args) => {
      if (name === "enqueue_job" && rows[0] !== undefined) rows[0].enabled = false;
      return original(name, args);
    });
    await runDueSchedules(db, new Date("2026-10-05T03:30:20.000Z"));
    expect(logged("schedule_rollback_missed")).toEqual([
      { level: "error", event: "schedule_rollback_missed", key: "prune" },
    ]);
  });

  it("a claim RPC error logs schedule_claim_failed and fires nothing", async () => {
    const { db, jobs } = setup([schedule("prune", { next_run_at: "2026-10-05T03:30:00.000Z" })], {
      claim: true,
    });
    await runDueSchedules(db, new Date("2026-10-05T03:30:20.000Z"));
    expect(jobs).toEqual([]);
    expect(logged("schedule_claim_failed")).toEqual([
      { level: "warn", event: "schedule_claim_failed", key: "prune" },
    ]);
  });

  it("a row with an invalid cron logs schedule_cron_invalid and the other rows still fire", async () => {
    const { db, jobs } = setup([
      schedule("digest", { cron: "not a cron" }),
      schedule("kpi_weekly", { cron: "bad", next_run_at: "2026-10-05T03:00:00.000Z" }),
      schedule("prune", { next_run_at: "2026-10-05T03:30:00.000Z" }),
    ]);
    expect(await runDueSchedules(db, new Date("2026-10-05T03:30:20.000Z"))).toBe(1);
    expect(jobs.map((job) => job.key)).toEqual(["prune:2026-10-05"]);
    expect(logged("schedule_cron_invalid")).toEqual([
      { level: "error", event: "schedule_cron_invalid", key: "digest" },
      { level: "error", event: "schedule_cron_invalid", key: "kpi_weekly" },
    ]);
  });

  it("keepwarm, audit and backup are never claimed by the runner, and a row not yet due is left alone", async () => {
    const due = { next_run_at: "2026-10-04T10:00:00.000Z" };
    const { db } = setup([
      schedule("keepwarm", due),
      schedule("audit", due),
      schedule("backup", due),
      schedule("reconcile", { next_run_at: "2026-10-04T10:30:00.000Z" }),
    ]);
    expect(await runDueSchedules(db, new Date("2026-10-04T10:15:00.000Z"))).toBe(0);
    expect(rpcCount(db, "claim_schedule")).toBe(0);
  });
});
