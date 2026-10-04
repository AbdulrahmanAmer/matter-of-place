import type { Json } from "../../db/index.ts";
import { fanoutPendingEvents } from "../automation/fanout.ts";
import type { Db } from "../lib/db.ts";
import { AppError } from "../lib/errors.ts";
import { logLine } from "../lib/log.ts";
import type { ClaimedJob } from "./claim.ts";
import { claimJob, failJob, finishJob, requeueJob } from "./claim.ts";
import { reapStaleJobs } from "./reaper.ts";
import { runDueSchedules } from "./scheduler.ts";
import { getStep } from "./steps/index.ts";
import { getSystemJob } from "./system/index.ts";
import type {
  JsonObject,
  Reporter,
  RunnerEnv,
  StepContext,
  StepDefinition,
  StepResult,
  SystemJobDefinition,
} from "./types.ts";
import { NonRetryableError } from "./types.ts";

// One tick of the job runner (architecture 5). The jobs row is the truth and a pgmq message only wakes the
// runner (invariant 5): each job is claimed right before it runs, and every message read is deleted once
// handled, never archived. A message read and never claimed reappears after the visibility timeout.

const BATCH = 10;
const HEAVY_PER_TICK = 3;
const VISIBILITY_S = 120;
const FANOUT_LIMIT = 50;
const START_CUTOFF_MS = 40_000;
const DEFAULT_TIMEOUT_MS = 20_000;
const LIGHT_TIMEOUT_CAP_MS = 40_000;
const UNKNOWN_WAIT_MS = 15 * 60 * 1000;
const UNKNOWN_DEAD_AFTER_MS = 24 * 60 * 60 * 1000;
const STORAGE_WAIT_MS = 60 * 60 * 1000;

export interface RunOptions {
  env: RunnerEnv;
  report: Reporter;
  /** Fixes the clock for tests; otherwise each claimed job takes `new Date()`. */
  now?: Date;
}

interface JobOutcome {
  id: string;
  outcome: "done" | "dispatched" | "requeued" | "failed" | "dead" | "lost";
  reason?: string;
}

export interface RunSummary {
  claimed: number;
  jobs: JobOutcome[];
}

type Runnable = StepDefinition | SystemJobDefinition;

const isJsonObject = (value: Json | undefined): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Rejects when the signal aborts, so a step that never settles cannot hold the tick (JOB-02).
function untilAborted<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(new Error("step_timeout"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    void work()
      .then(resolve, reject)
      .finally(() => {
        signal.removeEventListener("abort", onAbort);
      });
  });
}

function timeoutFor(def: Runnable): number {
  const timeout = def.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const heavy = "heavy" in def && def.heavy;
  return heavy ? timeout : Math.min(timeout, LIGHT_TIMEOUT_CAP_MS);
}

async function execute(job: ClaimedJob, def: Runnable, ctx: StepContext): Promise<StepResult> {
  const payload = isJsonObject(job.payload) ? job.payload : {};
  const data = isJsonObject(payload["data"]) ? payload["data"] : {};
  const rawParams = payload["params"] ?? {};
  if (!("paramsSchema" in def))
    return untilAborted(ctx.signal, () => def.run(ctx, rawParams, data));
  const params = def.paramsSchema.safeParse(rawParams);
  if (!params.success) throw new NonRetryableError("invalid_params");
  return untilAborted(ctx.signal, () => def.run(ctx, params.data, data));
}

async function settle(
  db: Db,
  job: ClaimedJob,
  result: StepResult,
): Promise<Omit<JobOutcome, "id">> {
  const ids = { jobId: job.id, claim: job.claim };
  switch (result.status) {
    case "done":
      return (await finishJob(db, { ...ids, result: result.result }))
        ? { outcome: "done" }
        : { outcome: "lost" };
    case "dispatched":
      return (await finishJob(db, { ...ids, result: result.result, dispatched: true }))
        ? { outcome: "dispatched" }
        : { outcome: "lost" };
    case "retry_at":
      return (await requeueJob(db, {
        ...ids,
        runAfter: result.at,
        kind: "requeued",
        result: result.result,
      }))
        ? { outcome: "requeued", reason: result.reason }
        : { outcome: "lost" };
  }
}

async function fail(
  db: Db,
  job: ClaimedJob,
  error: unknown,
  opts: RunOptions,
  { reason, dead }: { reason: string; dead: boolean },
): Promise<Omit<JobOutcome, "id">> {
  const changed = await failJob(db, { jobId: job.id, claim: job.claim, error: reason, dead });
  if (!changed) return { outcome: "lost" };
  if (!dead && job.attempts + 1 < job.max_attempts) return { outcome: "failed", reason };
  await opts.report(error, { fingerprint: ["job_dead", job.type] });
  return { outcome: "dead", reason };
}

async function runJob(db: Db, job: ClaimedJob, opts: RunOptions): Promise<JobOutcome> {
  const now = opts.now ?? new Date();
  const def: Runnable | undefined = getStep(job.type) ?? getSystemJob(job.type);
  if (def === undefined) {
    // A lane gap or a runner rollback never kills jobs: an unknown type waits a day (E2E-06, DO-10).
    if (now.getTime() - new Date(job.created_at).getTime() >= UNKNOWN_DEAD_AFTER_MS) {
      const error = new NonRetryableError("unknown_step");
      return {
        id: job.id,
        ...(await fail(db, job, error, opts, { reason: "unknown_step", dead: true })),
      };
    }
    const wait: StepResult = {
      status: "retry_at",
      at: new Date(now.getTime() + UNKNOWN_WAIT_MS),
      reason: "unknown_step",
    };
    return { id: job.id, ...(await settle(db, job, wait)) };
  }

  const signal = AbortSignal.timeout(timeoutFor(def));
  const ctx: StepContext = {
    db,
    env: opts.env,
    log: logLine,
    now,
    signal,
    report: opts.report,
    job: {
      id: job.id,
      type: job.type,
      attempts: job.attempts,
      claim: job.claim,
      result: job.result,
      eventId: job.event_id,
    },
  };
  let result: StepResult;
  try {
    result = await execute(job, def, ctx);
  } catch (error) {
    if (signal.aborted) {
      return {
        id: job.id,
        ...(await fail(db, job, error, opts, { reason: "step_timeout", dead: false })),
      };
    }
    if (error instanceof AppError && error.code === "storage_unavailable") {
      // A Storage outage uses no attempt: the job waits an hour (ruling H33 (2)).
      result = {
        status: "retry_at",
        at: new Date(now.getTime() + STORAGE_WAIT_MS),
        reason: "storage_unavailable",
      };
    } else {
      const dead = error instanceof NonRetryableError;
      return {
        id: job.id,
        ...(await fail(db, job, error, opts, { reason: errorText(error), dead })),
      };
    }
  }
  return { id: job.id, ...(await settle(db, job, result)) };
}

interface Tick {
  db: Db;
  opts: RunOptions;
  started: number;
  summary: RunSummary;
}

const pastCutoff = (tick: Tick): boolean => Date.now() - tick.started >= START_CUTOFF_MS;

// Reads one batch and runs its jobs. False once the queue is empty or the cutoff has passed.
async function runBatch(tick: Tick, heavy: boolean, qty: number): Promise<boolean> {
  const { db } = tick;
  const read = await db.rpc("job_queue_read", { p_heavy: heavy, p_vt: VISIBILITY_S, p_qty: qty });
  if (read.error !== null) {
    throw new AppError("unavailable", undefined, "The job system did not answer (job_queue_read).");
  }
  if (read.data.length === 0) return false;

  // Ruling H34 (2): a local job belongs to the laptop runner; its message is dropped and the job untouched.
  const local = await db
    .from("jobs")
    .select("id, run_local")
    .in(
      "id",
      read.data.map((message) => message.job_id),
    );
  if (local.error !== null) {
    throw new AppError("unavailable", undefined, "The job system did not answer (jobs).");
  }
  const localIds = new Set(local.data.filter((row) => row.run_local).map((row) => row.id));

  for (const message of read.data) {
    if (pastCutoff(tick)) return false;
    if (!localIds.has(message.job_id)) {
      const job = await claimJob(db, { jobId: message.job_id });
      if (job !== null) {
        tick.summary.claimed += 1;
        tick.summary.jobs.push(await runJob(db, job, tick.opts));
      }
    }
    const deleted = await db.rpc("job_queue_delete", { p_heavy: heavy, p_msg_id: message.msg_id });
    if (deleted.error !== null) {
      throw new AppError(
        "unavailable",
        undefined,
        "The job system did not answer (job_queue_delete).",
      );
    }
  }
  return read.data.length === qty;
}

// DO-03: the `runner` row the ops-health hook reads. A failed beat must not fail the tick; the row going stale is
// what the monitor sees.
async function beat(db: Db, claimed: number): Promise<void> {
  const { error } = await db.rpc("beat", { p_name: "runner", p_detail: { claimed } });
  if (error !== null) logLine("error", "runner_beat_failed", { message: error.message });
}

/**
 * One tick: the event sweep (JOB-07), the scheduler, the light queue in batches, at most HEAVY_PER_TICK
 * heavy jobs, then the reaper. No job starts after START_CUTOFF_MS; each runs under its own timeout.
 * Every tick ends with one beat, also a tick that throws.
 */
export async function runOnce(db: Db, opts: RunOptions): Promise<RunSummary> {
  const tick: Tick = { db, opts, started: Date.now(), summary: { claimed: 0, jobs: [] } };
  try {
    await fanoutPendingEvents(db, FANOUT_LIMIT);
    await runDueSchedules(db, opts.now ?? new Date());
    let more = true;
    while (more && !pastCutoff(tick)) more = await runBatch(tick, false, BATCH);
    if (!pastCutoff(tick)) await runBatch(tick, true, HEAVY_PER_TICK);
    await reapStaleJobs(db);
    return tick.summary;
  } finally {
    await beat(db, tick.summary.claimed);
  }
}
