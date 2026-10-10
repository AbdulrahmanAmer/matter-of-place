// B8b step 5, part 1 of the exit: `bun run scripts/automation-smoke.ts` with the dev profile loaded, on the one
// database before L1's launch switch only (ruling H35 (5)). It switches step `notify_admin_received` of
// `submission.received` off, shows that the dry-run skips it and that the deployed runner's real fan-out makes no job
// for it, runs one keep-warm tick, and puts the recipe back. The real-run line is a proof of the toggle only when the
// step is planned with it on; otherwise the script prints UNPROVEN. Its event row stays: `events` is append-only (B2
// invariant 3).
import { setTimeout as sleep } from "node:timers/promises";
import { createClient } from "@supabase/supabase-js";
import type { Database, Json } from "../src/db/index.ts";
import { dryRun } from "../src/server/automation/dry-run.ts";
import { samplePayloadFor } from "../src/server/automation/sample-payloads.ts";
import { emitEvent } from "../src/server/lib/events.ts";
import { runKeepWarm } from "../src/server/scheduled.ts";
import { holdDevLock } from "../tests/fixtures/dev-lock.ts";
import { assertNotProduction } from "./lib/assert-not-production.mjs";
import { guardEnv } from "./lib/guard-env.mjs";

const TRIGGER = "submission.received";
const STEP = "notify_admin_received";
const WAIT_MS = 120_000;
const POLL_MS = 5_000;
type PutRecipeArgs = Database["public"]["Functions"]["automation_put_recipe"]["Args"];
// No person: a null actor is the system, so the revision and audit rows carry no user and the note `smoke`.
// `write_audit` refuses any other actor without a role (DB-04, H1-31).
// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- the generated Args type lists both actor arguments as non-null; null is the system actor
const SYSTEM_ACTOR = { p_actor: null, p_actor_kind: null } as unknown as Pick<
  PutRecipeArgs,
  "p_actor" | "p_actor_kind"
>;
const CANCELLABLE = new Set(["queued", "waiting_approval"]);

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`automation-smoke: ${name} is not set`);
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

function failed(what: string, error: { message: string }): Error {
  return new Error(`automation-smoke: ${what} failed: ${error.message}`);
}

async function readSteps(db: DevDb): Promise<Json> {
  const { data, error } = await db
    .from("automation_recipes")
    .select("steps")
    .eq("trigger", TRIGGER);
  if (error !== null) throw failed("reading the recipe", error);
  const row = data[0];
  if (row === undefined) throw new Error(`automation-smoke: no recipe for ${TRIGGER}`);
  return row.steps;
}

async function putSteps(db: DevDb, steps: Json, note: string): Promise<void> {
  const { error } = await db.rpc("automation_put_recipe", {
    p_trigger: TRIGGER,
    p_patch: { steps },
    ...SYSTEM_ACTOR,
    p_request_id: `smoke:${note}:${new Date().toISOString()}`,
    p_note: note,
  });
  if (error !== null) throw failed(`automation_put_recipe (${note})`, error);
}

type JsonObject = { [key: string]: Json | undefined };

const isObject = (value: Json | undefined): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The step the smoke switches off, from the stored array. */
function stepOf(steps: Json): JsonObject | undefined {
  return Array.isArray(steps)
    ? steps.filter(isObject).find((step) => step["id"] === STEP)
    : undefined;
}

/** The stored steps with that step switched off; every other step and field stays as stored. */
function withStepOff(steps: Json): Json {
  const step = stepOf(steps);
  if (step === undefined || !Array.isArray(steps)) {
    throw new Error(`automation-smoke: ${TRIGGER} has no step ${STEP}`);
  }
  return steps.map((each) => (each === step ? { ...step, enabled: false } : each));
}

async function newestSubmission(db: DevDb): Promise<string> {
  const { data, error } = await db
    .from("submissions")
    .select("id")
    .order("received_at", { ascending: false })
    .limit(1);
  if (error !== null) throw failed("reading submissions", error);
  const row = data[0];
  if (row === undefined) {
    throw new Error("no submission on mop-dev, run bun run fixtures:load");
  }
  return row.id;
}

async function waitProcessed(db: DevDb, eventId: string): Promise<void> {
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    const { data, error } = await db.from("events").select("processed_at").eq("id", eventId);
    if (error !== null) throw failed("reading the event", error);
    const processedAt = data[0]?.processed_at;
    if (processedAt !== null && processedAt !== undefined) return;
    if (Date.now() >= deadline) {
      throw new Error(
        `automation-smoke: the runner did not plan event ${eventId} within ${String(WAIT_MS / 1000)} s`,
      );
    }
    await sleep(POLL_MS);
  }
}

async function jobsOf(db: DevDb, eventId: string) {
  const { data, error } = await db
    .from("jobs")
    .select("id, step_id, status")
    .eq("event_id", eventId);
  if (error !== null) throw failed("reading the jobs", error);
  return data;
}

async function cancelOpenJobs(db: DevDb, eventId: string): Promise<void> {
  for (const job of await jobsOf(db, eventId)) {
    if (!CANCELLABLE.has(job.status)) continue;
    const { error } = await db.rpc("cancel_job", { p_job_id: job.id, p_message: "smoke" });
    if (error !== null) throw failed("cancel_job", error);
  }
}

async function keepWarmRow(db: DevDb) {
  const { data, error } = await db
    .from("schedule_settings")
    .select("cron, last_run_at")
    .eq("key", "keepwarm");
  if (error !== null) throw failed("reading the keepwarm row", error);
  const row = data[0];
  if (row === undefined) throw new Error("automation-smoke: no keepwarm schedule row");
  return row;
}

/** Why the planner leaves the step out with the step on, or undefined when it plans it. */
async function skipReasonWhenOn(db: DevDb, submissionId: string): Promise<string | undefined> {
  const dry = await dryRun(db, { trigger: TRIGGER, entity_id: submissionId });
  return dry.skipped.find((step) => step.step_id === STEP)?.reason;
}

/** The planner's two outputs for the switched-off step, then the keep-warm tick. */
async function smoke(
  db: DevDb,
  submissionId: string,
  reasonWhenOn: string | undefined,
): Promise<void> {
  const dry = await dryRun(db, { trigger: TRIGGER, entity_id: submissionId });
  const dryReason = dry.skipped.find((step) => step.step_id === STEP)?.reason;
  if (dryReason !== "step_disabled") {
    throw new Error(`automation-smoke: the dry-run gave ${dryReason ?? "no skip"} for ${STEP}`);
  }
  console.log(`dry-run skipped ${STEP} (${dryReason})`);

  const payload = await samplePayloadFor(db, TRIGGER, submissionId, new Date());
  const eventId = await emitEvent(db, {
    type: TRIGGER,
    entity: "submission",
    entityId: submissionId,
    payload,
  });
  await waitProcessed(db, eventId);
  const forStep = (await jobsOf(db, eventId)).filter((job) => job.step_id === STEP);
  if (forStep.length > 0) {
    throw new Error(
      `automation-smoke: the real run made ${String(forStep.length)} job for ${STEP}`,
    );
  }
  // The real run records no skip. No job proves the toggle only when the step is planned with it on.
  if (reasonWhenOn === undefined) {
    console.log(`real run skipped ${STEP} (step_disabled)`);
    console.log(`jobs for step: ${String(forStep.length)}`);
  } else {
    console.log(
      `UNPROVEN: real run, ${STEP} is skipped as ${reasonWhenOn} with the step on, so ${String(forStep.length)} jobs for it says nothing about the toggle`,
    );
  }
  await cancelOpenJobs(db, eventId);

  const before = await keepWarmRow(db);
  await runKeepWarm({
    db,
    fetch: () => Promise.resolve(new Response("ok", { status: 200 })),
    cron: before.cron,
    origin: "https://matterofplace.com",
    now: new Date(),
    mopEnv: undefined,
    report: () => Promise.resolve(),
  });
  const after = await keepWarmRow(db);
  if (after.last_run_at === null || after.last_run_at === before.last_run_at) {
    throw new Error("automation-smoke: keepwarm last_run_at did not move");
  }
  console.log("keepwarm last_run_at moved");
}

async function main(): Promise<void> {
  guardEnv();
  await assertNotProduction({ dbUrl: process.env["DEV_DB_URL"] });
  const db = devDb();
  const release = await holdDevLock();
  let original: Json | undefined;
  let changed = false;
  try {
    original = await readSteps(db);
    const submissionId = await newestSubmission(db);
    const reasonWhenOn = await skipReasonWhenOn(db, submissionId);
    await putSteps(db, withStepOff(original), "smoke");
    changed = true;
    await smoke(db, submissionId, reasonWhenOn);
  } finally {
    try {
      if (changed && original !== undefined) await putSteps(db, original, "smoke-restore");
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
    await release();
  }
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
