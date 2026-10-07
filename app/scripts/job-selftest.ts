// B8 step 8: proves the job system end to end on the one database, before L1's launch switch only (ruling H35 (5)).
// `bun run scripts/job-selftest.ts [--light-only | --fail-light | --reconcile | --event property.published --fixture]`
// with the dev profile loaded. It enqueues jobs, lets the deployed runner take them on its cron tick, and polls each
// one until it settles. The event form (B9 step 10) publishes the fixture property's event and follows its jobs.
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { createClient } from "@supabase/supabase-js";
import type { Database, Json } from "../src/db/index.ts";
import fixture from "../src/templates/social/fixtures/property.fixture.json";
import { holdDevLock } from "../tests/fixtures/dev-lock.ts";
import { assertNotProduction } from "./lib/assert-not-production.mjs";
import { guardEnv } from "./lib/guard-env.mjs";

const MODES = ["--light-only", "--fail-light", "--reconcile"] as const;
const EVENT_ARGS = "--event property.published --fixture";
type Mode = (typeof MODES)[number] | "full" | "event";

const POLL_MS = 5_000;
// A light job waits at most one cron minute for its tick; the heavy one also waits for a render.yml run.
const LIGHT_LIMIT_MS = 90_000;
const HEAVY_LIMIT_MS = 15 * 60_000;
const SETTLED = new Set(["done", "dead", "cancelled"]);
const HEAVY_TIMELINE = ["created", "claimed", "dispatched", "callback", "done"];

interface Settled {
  status: string;
  error: string | null;
  result: Json | null;
}

function parseMode(args: string[]): Mode {
  if (args.length === 0) return "full";
  if (args.join(" ") === EVENT_ARGS) return "event";
  const [flag] = args;
  const mode = MODES.find((known) => known === flag);
  if (args.length > 1 || mode === undefined) {
    throw new Error(
      `usage: bun run scripts/job-selftest.ts [${[...MODES, EVENT_ARGS].join(" | ")}]`,
    );
  }
  return mode;
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`job-selftest: ${name} is not set`);
  return value;
}

/** Built from the dev profile's own names, never SUPABASE_URL, which a shell may hold for another project (P-331). */
function devDb() {
  return createClient<Database>(
    `https://${requiredEnv("DEV_SUPABASE_PROJECT_REF")}.supabase.co`,
    requiredEnv("DEV_SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
type DevDb = ReturnType<typeof devDb>;

interface Enqueue {
  type: string;
  idempotencyKey: string;
  params?: { [key: string]: Json };
  heavy?: boolean;
}

// The envelope of enqueueJob() (src/server/lib/jobs.ts), whose Db type needs the DOM lib that scripts do not load.
async function enqueued(db: DevDb, input: Enqueue): Promise<string> {
  const { data, error } = await db.rpc("enqueue_job", {
    p_type: input.type,
    p_payload: { params: input.params ?? {}, data: {} },
    p_idempotency_key: input.idempotencyKey,
    p_heavy: input.heavy ?? false,
  });
  if (error !== null) throw new Error(`job-selftest: enqueue_job failed: ${error.message}`);
  // The generated type says string; enqueue_job answers null when the key already exists (invariant 1).
  if (!data) throw new Error(`job-selftest: ${input.idempotencyKey} already exists`);
  return data;
}

async function waitSettled(db: DevDb, id: string, limitMs: number): Promise<Settled> {
  const deadline = Date.now() + limitMs;
  for (;;) {
    const { data, error } = await db
      .from("jobs")
      .select("status, error, result")
      .eq("id", id)
      .single();
    if (error !== null) throw new Error(`job-selftest: reading job ${id} failed: ${error.message}`);
    if (SETTLED.has(data.status)) return data;
    if (Date.now() >= deadline) {
      throw new Error(
        `job-selftest: job ${id} still ${data.status} after ${String(limitMs / 1000)} s`,
      );
    }
    await sleep(POLL_MS);
  }
}

async function expectStatus(
  db: DevDb,
  id: string,
  { want, limitMs, label }: { want: string; limitMs: number; label: string },
): Promise<Settled> {
  const started = Date.now();
  const job = await waitSettled(db, id, limitMs);
  if (job.status !== want) {
    throw new Error(`job-selftest: ${label} ended ${job.status} (${job.error ?? "no error"})`);
  }
  console.log(`${label} ${want} in ${String(Math.round((Date.now() - started) / 1000))} s`);
  return job;
}

async function timeline(db: DevDb, id: string): Promise<string[]> {
  const { data, error } = await db
    .from("job_events")
    .select("kind")
    .eq("job_id", id)
    .order("id", { ascending: true });
  if (error !== null) throw new Error(`job-selftest: reading job_events failed: ${error.message}`);
  return data.map((row) => row.kind);
}

async function runLight(db: DevDb, runId: string): Promise<void> {
  const id = await enqueued(db, {
    type: "test.selftest_light",
    idempotencyKey: `test:${runId}:light`,
  });
  await expectStatus(db, id, { want: "done", limitMs: LIGHT_LIMIT_MS, label: "light" });
}

async function runHeavy(db: DevDb, runId: string): Promise<void> {
  const id = await enqueued(db, {
    type: "test.selftest_heavy",
    idempotencyKey: `test:${runId}:heavy`,
    heavy: true,
  });
  await expectStatus(db, id, { want: "done", limitMs: HEAVY_LIMIT_MS, label: "heavy" });
  const kinds = await timeline(db, id);
  console.log(`heavy timeline: ${kinds.join(", ")}`);
  if (kinds.join(",") !== HEAVY_TIMELINE.join(",")) {
    throw new Error(`job-selftest: heavy timeline is not ${HEAVY_TIMELINE.join(", ")}`);
  }
}

async function runFailLight(db: DevDb, runId: string): Promise<void> {
  const id = await enqueued(db, {
    type: "test.selftest_light",
    idempotencyKey: `test:${runId}:fail-light`,
    params: { fail: "nonretryable" },
  });
  await expectStatus(db, id, { want: "dead", limitMs: LIGHT_LIMIT_MS, label: "fail-light" });
}

async function runReconcile(db: DevDb, runId: string): Promise<void> {
  const id = await enqueued(db, { type: "reconcile", idempotencyKey: `test:${runId}:reconcile` });
  const job = await expectStatus(db, id, {
    want: "done",
    limitMs: LIGHT_LIMIT_MS,
    label: "reconcile",
  });
  const uploads =
    typeof job.result === "object" && job.result !== null && !Array.isArray(job.result)
      ? job.result["uploads"]
      : undefined;
  console.log(`reconcile uploads: ${JSON.stringify(uploads ?? null)}`);
}

interface EventJob {
  type: string;
  status: string;
  run_local: boolean;
}

async function eventJobs(db: DevDb, eventId: string): Promise<EventJob[]> {
  const { data, error } = await db
    .from("jobs")
    .select("type, status, run_local")
    .eq("event_id", eventId)
    .order("type");
  if (error !== null)
    throw new Error(`job-selftest: reading the event's jobs failed: ${error.message}`);
  return data;
}

/** Emits `property.published` for the fixture property under the writer lock (G34), then follows its jobs. */
async function runEvent(db: DevDb): Promise<void> {
  const { slug } = fixture.property;
  const { data: property, error } = await db
    .from("properties")
    .select("id, slug, campaign_tier, market_slug")
    .eq("slug", slug)
    .maybeSingle();
  if (error !== null) throw new Error(`job-selftest: reading ${slug} failed: ${error.message}`);
  if (property === null)
    throw new Error(`job-selftest: no property ${slug}; run B2's dev seed first`);
  const release = await holdDevLock();
  let emitted: string;
  try {
    const { data, error: emitError } = await db.rpc("emit_event", {
      p_type: "property.published",
      p_entity: "property",
      p_entity_id: property.id,
      p_payload: {
        property_id: property.id,
        slug: property.slug,
        tier: property.campaign_tier,
        market: property.market_slug,
      },
    });
    if (emitError !== null)
      throw new Error(`job-selftest: emit_event failed: ${emitError.message}`);
    emitted = data;
  } finally {
    await release();
  }
  console.log(`property.published ${emitted} for ${slug} (${property.id})`);
  // The runner's sweep plans the event on a cron tick; write_captions then waits for the laptop runner (H34 (2)).
  const planned = Date.now() + LIGHT_LIMIT_MS;
  let jobs = await eventJobs(db, emitted);
  while (jobs.length === 0 && Date.now() < planned) {
    await sleep(POLL_MS);
    jobs = await eventJobs(db, emitted);
  }
  if (jobs.length === 0) throw new Error(`job-selftest: event ${emitted} planned no job`);
  const deadline = Date.now() + HEAVY_LIMIT_MS;
  const open = (all: EventJob[]) => all.filter((job) => !job.run_local && !SETTLED.has(job.status));
  while (open(jobs).length > 0 && Date.now() < deadline) {
    await sleep(POLL_MS);
    jobs = await eventJobs(db, emitted);
  }
  for (const job of jobs) console.log(`${job.type} ${job.status}`);
  const unsettled = open(jobs).map((job) => job.type);
  if (unsettled.length > 0) {
    throw new Error(`job-selftest: still open after 900 s: ${unsettled.join(", ")}`);
  }
  const dead = jobs.filter((job) => job.status === "dead").map((job) => job.type);
  if (dead.length > 0) throw new Error(`job-selftest: dead: ${dead.join(", ")}`);
}

async function main(): Promise<void> {
  const mode = parseMode(process.argv.slice(2));
  guardEnv();
  await assertNotProduction({ dbUrl: process.env["DEV_DB_URL"] });
  const db = devDb();
  const runId = randomUUID();
  switch (mode) {
    case "--fail-light":
      await runFailLight(db, runId);
      return;
    case "--reconcile":
      await runReconcile(db, runId);
      return;
    case "--light-only":
      await runLight(db, runId);
      return;
    case "event":
      await runEvent(db);
      return;
    case "full":
      await runLight(db, runId);
      await runHeavy(db, runId);
      return;
  }
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
