import { z } from "zod";
import { nextRun } from "./automation/cron.ts";
import type { Db } from "./lib/db.ts";
import { logLine } from "./lib/log.ts";
import type { LogEvent } from "./lib/log-events.ts";
import { getPublicState } from "./public/state.ts";

// The keep-warm tick of the Worker's `scheduled()` (B8b invariant 15 c): it touches the database even when the page is
// a cache hit (F26 b), and it reports a stalled job runner (JOB-04). The clock row changes only
// through `claim_schedule` (G43). The tick never throws.

const STALE_BEAT_MS = 300_000;
const STALE_DUE_AGE_S = 900;

const liveness = z.object({
  runner_beat_at: z.string().nullable(),
  oldest_due_age_s: z.number().nullable(),
});

export interface KeepWarmInput {
  db: Db;
  /** Nitro's in-process app fetch: the request never leaves the isolate. */
  fetch: (request: Request) => Promise<Response>;
  cron: string;
  origin: string;
  now: Date;
  mopEnv: string | undefined;
  report: (error: Error, options: { fingerprint: string[] }) => Promise<void>;
}

interface Answer<T> {
  data: T | null;
  error: { message: string } | null;
}

/** One call that may fail: the failure is logged under `event` and the tick goes on. */
async function attempt<T>(
  event: LogEvent,
  call: () => PromiseLike<Answer<T>>,
): Promise<{ data: T | null } | undefined> {
  try {
    const { data, error } = await call();
    if (error === null) return { data };
    logLine("warn", event, { reason: error.message });
  } catch (error) {
    logLine("warn", event, { reason: error instanceof Error ? error.message : "unknown" });
  }
  return undefined;
}

function stalled(value: unknown, now: Date): boolean {
  const { runner_beat_at: beat, oldest_due_age_s: age } = liveness.parse(value);
  const beatAgeMs = beat === null ? Number.POSITIVE_INFINITY : now.getTime() - Date.parse(beat);
  return beatAgeMs > STALE_BEAT_MS || (age !== null && age > STALE_DUE_AGE_S);
}

async function pageStatus(input: KeepWarmInput): Promise<{ status: number; cache: string }> {
  try {
    const response = await input.fetch(new Request(new URL("/", input.origin)));
    return { status: response.status, cache: response.headers.get("x-mop-cache") ?? "none" };
  } catch {
    return { status: 0, cache: "none" };
  }
}

/** Runs one keep-warm tick: the clock, the state read, the heartbeat, the runner check, one page. */
export async function runKeepWarm(input: KeepWarmInput): Promise<void> {
  const { db, cron, now } = input;
  const claimed = await attempt("keepwarm_last_run_update_failed", () =>
    db.rpc("claim_schedule", {
      p_key: "keepwarm",
      p_guard: false,
      p_last_run_at: now.toISOString(),
      p_next_run_at: nextRun(cron, now).toISOString(),
    }),
  );
  if (claimed?.data === false) {
    logLine("info", "keepwarm_disabled");
    return;
  }
  await attempt("keepwarm_state_rpc_failed", async () => ({
    data: await getPublicState(db),
    error: null,
  }));
  await attempt("keepwarm_beat_failed", () =>
    db.rpc("beat", { p_name: "keepwarm", p_detail: { cron } }),
  );
  if (input.mopEnv === "production") {
    await attempt("keepwarm_liveness_rpc_failed", async () => {
      const answer = await db.rpc("jobs_liveness", { p_now: now.toISOString() });
      if (answer.error === null && stalled(answer.data, now)) {
        await input.report(new Error("job_runner_stalled"), {
          fingerprint: ["job_runner_stalled"],
        });
      }
      return answer;
    });
  }
  const { status, cache } = await pageStatus(input);
  logLine("info", "keepwarm_tick", { status, cache, stateRpc: 1 });
}
