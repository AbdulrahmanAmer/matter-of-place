import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { Database, Json } from "../../../src/db";
import { stepSchema } from "../../../src/domain/automation";
import { dryRun } from "../../../src/server/automation/dry-run";
import { fanoutEvent, fanoutPendingEvents } from "../../../src/server/automation/fanout";
import { planEvent } from "../../../src/server/automation/plan";
import type { StepDefinition } from "../../../src/server/jobs/types";
import { fakeDb, type FakeDb } from "../../fixtures/fake-db";

// Step types every case registers in B8's step registry, so the planner sees them implemented.
const implemented = vi.hoisted(
  () =>
    new Set([
      "send_email",
      "notify_admin",
      "bump_catalog_version",
      "purge_cache",
      "write_captions",
      "render_reel",
    ]),
);

vi.mock(import("../../../src/server/jobs/steps/index.ts"), () => ({
  getStep: (type: string): StepDefinition | undefined =>
    implemented.has(type)
      ? {
          type,
          heavy: false,
          paramsSchema: z.unknown(),
          run: () => Promise.resolve({ status: "done" }),
        }
      : undefined,
}));

type EventRow = Database["public"]["Functions"]["fanout_pending_events"]["Returns"][number];
type RecipeRow = Database["public"]["Tables"]["automation_recipes"]["Row"];
type RecipeTemplate = Database["public"]["Tables"]["email_templates"]["Row"];
type InsertArgs = Database["public"]["Functions"]["fanout_insert_jobs"]["Args"];

const HOUR = 3_600_000;
const RECIPE_ID = "7a1b2c3d-0000-4000-8000-000000000001";
const SUBMISSION = "7a1b2c3d-0000-4000-8000-0000000000aa";
const PROPERTY = "7a1b2c3d-0000-4000-8000-0000000000bb";

// A recipe step as the stored JSON (a type alias, so it is assignable to `Json`).
type JsonStep = {
  id: string;
  step_type: string;
  params: { [key: string]: Json };
  enabled: boolean;
  requires_approval: boolean;
  conditions: { tiers?: string[] };
};

function step(id: string, step_type: string, overrides: Partial<JsonStep> = {}): JsonStep {
  return {
    id,
    step_type,
    params: {},
    enabled: true,
    requires_approval: false,
    conditions: {},
    ...overrides,
  };
}

function recipe(trigger: string, steps: JsonStep[]): RecipeRow {
  return {
    id: RECIPE_ID,
    trigger,
    name: trigger,
    enabled: true,
    version: 1,
    steps,
    created_at: "2026-10-01T00:00:00.000Z",
    updated_at: "2026-10-01T00:00:00.000Z",
  };
}

const published = recipe("property.published", [
  step("bump_catalog_version", "bump_catalog_version"),
  step("purge_cache", "purge_cache", { enabled: false }),
  step("render_variants", "render_variants"),
  step("write_captions", "write_captions"),
  step("render_reel", "render_reel", { conditions: { tiers: ["Campaign"] } }),
  step("send_standalone", "send_email", {
    params: { template: "standalone" },
    requires_approval: true,
  }),
]);

const standaloneTemplate: RecipeTemplate = {
  id: "7a1b2c3d-0000-4000-8000-0000000000dd",
  key: "standalone",
  subject: "Subject",
  preheader: "",
  body: [],
  variables: [],
  enabled: true,
  version: 1,
  created_at: "2026-10-01T00:00:00.000Z",
  updated_at: "2026-10-01T00:00:00.000Z",
};

const received = recipe("submission.received", [
  step("send_received", "send_email", { params: { template: "received" } }),
]);

let seq = 0;
function event(type: string, payload: Json, ageMs = 60_000): EventRow {
  seq += 1;
  return {
    id: `7a1b2c3d-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    type,
    payload: payload ?? {},
    at: new Date(Date.now() - ageMs).toISOString(),
    entity: null,
    entity_id: null,
    actor_id: null,
    processed_at: null,
  };
}

const publishedEvent = () =>
  event("property.published", { property_id: PROPERTY, tier: "Feature", market: "california" });
const receivedEvent = (ageMs?: number) =>
  event("submission.received", { submission_id: SUBMISSION }, ageMs);

interface Setup {
  db: FakeDb;
  inserts: InsertArgs[];
  jobs: Map<string, Json>;
}

/**
 * The sweep's three functions as their SQL behaves: `fanout_pending_events` leaves out a recorded failure (its
 * `next_at` is ahead) and a processed event, `enqueue_job` keeps one job per key.
 */
function setup(
  events: EventRow[],
  recipes: RecipeRow[],
  failing: ReadonlySet<string> = new Set(),
  { nextAtPassed = false, recordFails = false } = {},
): Setup {
  const inserts: InsertArgs[] = [];
  const jobs = new Map<string, Json>();
  const recorded = new Set<string>();
  const processed = new Set<string>();
  const waiting = (id: string) => recorded.has(id) && !nextAtPassed;
  const db = fakeDb({
    tables: { events, automation_recipes: recipes },
    rpc: {
      fanout_pending_events: (args) =>
        events.filter((row) => !waiting(row.id) && !processed.has(row.id)).slice(0, args.p_limit),
      fanout_insert_jobs: (args) => {
        inserts.push(args);
        if (failing.has(args.p_event_id)) return new Error("insert failed");
        processed.add(args.p_event_id);
        return Array.isArray(args.p_jobs) ? args.p_jobs.length : 0;
      },
      record_fanout_failure: (args) => {
        if (recordFails) return new Error("interval out of range");
        recorded.add(args.p_event_id);
        return undefined;
      },
      enqueue_job: (args) => {
        if (!jobs.has(args.p_idempotency_key)) {
          jobs.set(args.p_idempotency_key, {
            type: args.p_type,
            payload: args.p_payload,
            max_attempts: args.p_max_attempts ?? null,
          });
        }
        return "7a1b2c3d-0000-4000-8000-0000000000cc";
      },
    },
  });
  return { db, inserts, jobs };
}

let lines: string[] = [];

beforeEach(() => {
  lines = [];
  const capture = (line: string) => {
    lines.push(line);
  };
  vi.spyOn(console, "warn").mockImplementation(capture);
  vi.spyOn(console, "error").mockImplementation(capture);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const logged = (name: string) =>
  lines
    .map((line) => z.record(z.string(), z.unknown()).parse(JSON.parse(line)))
    .filter((line) => line["event"] === name);

const plannedJobs = (args: InsertArgs | undefined) =>
  z
    .array(z.record(z.string(), z.unknown()))
    .parse(args?.p_jobs ?? [])
    .map((job) => ({ step: job["step_id"], job }));

const rpcCount = (db: FakeDb, name: string) =>
  db.calls.filter((call) => call.kind === "rpc" && call.name === name).length;

describe("fanoutEvent (invariants 3 to 5)", () => {
  it("sends exactly the planned list planEvent gives for the same event", async () => {
    const row = publishedEvent();
    const { db, inserts } = setup([row], [published]);
    await fanoutEvent(db, row.id);
    const steps = z.array(stepSchema).parse(published.steps);
    const plan = planEvent(
      { id: published.id, trigger: published.trigger, enabled: published.enabled, steps },
      { id: row.id, payload: { property_id: PROPERTY, tier: "Feature", market: "california" } },
      { registry: (type) => (implemented.has(type) ? {} : undefined) },
    );
    expect(plan.planned.map((job) => job.step_id)).toEqual([
      "bump_catalog_version",
      "write_captions",
      "send_standalone",
    ]);
    expect(inserts[0]?.p_jobs).toEqual(JSON.parse(JSON.stringify(plan.planned)));
  });

  it("dry-run plans the same jobs as the real run, a disabled step and a condition included", async () => {
    const payload = { property_id: PROPERTY, tier: "Feature", market: "california" };
    const row = event("property.published", payload);
    const { db, inserts } = setup([row], [published]);
    await fanoutEvent(db, row.id);
    const reads = fakeDb({
      tables: { automation_recipes: [published], email_templates: [standaloneTemplate] },
    });
    const dry = await dryRun(reads, { trigger: "property.published", payload });
    const real = plannedJobs(inserts[0]).map(({ job }) => ({
      step_id: job["step_id"],
      type: job["type"],
      heavy: job["heavy"],
      run_local: job["run_local"],
      status: job["status"],
      max_attempts: job["max_attempts"],
    }));
    expect(real.map((job) => job.step_id)).toEqual([
      "bump_catalog_version",
      "write_captions",
      "send_standalone",
    ]);
    expect(
      dry.planned.map(({ step_id, type, heavy, run_local, status, max_attempts }) => ({
        step_id,
        type,
        heavy,
        run_local,
        status,
        max_attempts,
      })),
    ).toEqual(real);
    expect(dry.skipped.map((skip) => [skip.step_id, skip.reason])).toEqual([
      ["purge_cache", "step_disabled"],
      ["render_variants", "not_implemented"],
      ["render_reel", "condition"],
    ]);
  });

  it("makes exactly one fanout_insert_jobs RPC", async () => {
    const row = publishedEvent();
    const { db } = setup([row], [published]);
    expect(await fanoutEvent(db, row.id)).toBe(3);
    expect(rpcCount(db, "fanout_insert_jobs")).toBe(1);
    expect(db.calls.filter((call) => call.kind === "rpc").map((call) => call.name)).toEqual([
      "fanout_insert_jobs",
    ]);
  });

  it("a recipe edit after fan-out leaves the RPC's params as planned", async () => {
    const row = receivedEvent();
    const stored = step("send_received", "send_email", { params: { template: "received" } });
    const { db, inserts } = setup([row], [recipe("submission.received", [stored])]);
    await fanoutEvent(db, row.id);
    // In place: an implementation that handed out the stored params object would show this edit.
    stored.params["template"] = "changed";
    expect(plannedJobs(inserts[0])[0]?.job["payload"]).toEqual({
      params: { template: "received" },
      data: { submission_id: SUBMISSION },
    });
  });

  it("carries max_attempts 12 for send_email and the default 5 for bump_catalog_version", async () => {
    const row = publishedEvent();
    const { db, inserts } = setup([row], [published]);
    await fanoutEvent(db, row.id);
    const attempts = plannedJobs(inserts[0]).map(({ step, job }) => [step, job["max_attempts"]]);
    expect(attempts).toEqual([
      ["bump_catalog_version", 5],
      ["write_captions", 12],
      ["send_standalone", 12],
    ]);
  });

  it("sets run_local true for the write_captions step only", async () => {
    const row = publishedEvent();
    const { db, inserts } = setup([row], [published]);
    await fanoutEvent(db, row.id);
    const local = plannedJobs(inserts[0]).map(({ step, job }) => [step, job["run_local"]]);
    expect(local).toEqual([
      ["bump_catalog_version", false],
      ["write_captions", true],
      ["send_standalone", false],
    ]);
  });

  it("an invalid payload is still planned with the raw payload and logged once", async () => {
    const row = event("submission.received", { submission_id: "not-a-uuid" });
    const { db, inserts } = setup([row], [received]);
    await fanoutEvent(db, row.id);
    expect(plannedJobs(inserts[0])[0]?.job["payload"]).toEqual({
      params: { template: "received" },
      data: { submission_id: "not-a-uuid" },
    });
    expect(logged("fanout_payload_invalid")).toEqual([
      { level: "warn", event: "fanout_payload_invalid", eventId: row.id },
    ]);
  });
});

describe("fanoutPendingEvents (invariant 4, JOB-07)", () => {
  it("a first event whose RPC throws does not stop the second", async () => {
    const first = receivedEvent();
    const second = receivedEvent();
    const { db, inserts } = setup([first, second], [received], new Set([first.id]));
    expect(await fanoutPendingEvents(db, 50)).toBe(1);
    expect(inserts.map((args) => args.p_event_id)).toEqual([first.id, second.id]);
    expect(logged("fanout_failed")).toEqual([
      { level: "warn", event: "fanout_failed", eventId: first.id, code: "unavailable" },
    ]);
    expect(rpcCount(db, "record_fanout_failure")).toBe(1);
  });

  it("a failure record_fanout_failure cannot store is logged and the sweep goes on", async () => {
    const first = receivedEvent(2 * HOUR);
    const second = receivedEvent();
    const { db, inserts, jobs } = setup([first, second], [received], new Set([first.id]), {
      recordFails: true,
    });
    expect(await fanoutPendingEvents(db, 50)).toBe(1);
    expect(inserts.map((args) => args.p_event_id)).toEqual([first.id, second.id]);
    expect(logged("fanout_failure_unrecorded")).toEqual([
      {
        level: "error",
        event: "fanout_failure_unrecorded",
        eventId: first.id,
        code: "unavailable",
      },
    ]);
    expect([...jobs.keys()]).toEqual([]);
  });

  it("with limit 2 and two always-failing events the next tick plans a third", async () => {
    const events = [receivedEvent(), receivedEvent(), receivedEvent()];
    const failing = new Set(events.slice(0, 2).map((row) => row.id));
    const { db, inserts } = setup(events, [received], failing);
    await fanoutPendingEvents(db, 2);
    await fanoutPendingEvents(db, 2);
    expect(inserts.map((args) => args.p_event_id)).toEqual(events.map((row) => row.id));
  });

  it("an event failing an hour after its at enqueues one notify_admin job however many sweeps fail", async () => {
    const old = receivedEvent(2 * HOUR);
    const recent = receivedEvent(10 * 60_000);
    const { db, jobs } = setup([old, recent], [], new Set(), { nextAtPassed: true });
    await fanoutPendingEvents(db, 50);
    await fanoutPendingEvents(db, 50);
    await fanoutPendingEvents(db, 50);
    expect([...jobs.keys()]).toEqual([`fanout_failed:${old.id}`]);
    expect(jobs.get(`fanout_failed:${old.id}`)).toEqual({
      type: "notify_admin",
      payload: {
        params: { headline: "Event could not be planned" },
        data: {
          summary: `submission.received ${old.id}: unknown_trigger`,
          link_path: "/admin/jobs",
        },
      },
      max_attempts: 12,
    });
    expect(rpcCount(db, "record_fanout_failure")).toBe(6);
  });
});
