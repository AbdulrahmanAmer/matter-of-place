import { isDue, scheduleNext, type ScheduleClock } from "../automation/cron.ts";
import type { Db } from "../lib/db.ts";
import { AppError } from "../lib/errors.ts";
import { emitEvent } from "../lib/events.ts";
import { enqueueJob } from "../lib/jobs.ts";
import { logLine } from "../lib/log.ts";
import { getSystemJob } from "./system/index.ts";

// The schedules the runner drives every tick (B8b invariant 11). `keepwarm` is fired by the Worker's `scheduled()`,
// `audit` and `backup` by their own clocks. The clocks change only through `claim_schedule` (G43).

const runnerKeys = ["digest", "prune", "reconcile", "kpi_weekly", "newsletter_hygiene"] as const;
type RunnerKey = (typeof runnerKeys)[number];

interface ScheduleRow extends ScheduleClock {
  key: string;
}

const isRunnerKey = (key: string): key is RunnerKey => runnerKeys.some((known) => known === key);

const utcDate = (now: Date) => now.toISOString().slice(0, 10);

/** `<UTC date>T<HH:MM>` with the minute rounded down to the quarter hour. */
function quarterHour(now: Date): string {
  const minute = now.getUTCMinutes() - (now.getUTCMinutes() % 15);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${utcDate(now)}T${pad(now.getUTCHours())}:${pad(minute)}`;
}

type Fire = (db: Db, now: Date, since: string | null) => Promise<unknown>;

const fire: Record<RunnerKey, Fire> = {
  digest: (db, now) =>
    emitEvent(db, {
      type: "digest.due",
      entity: "system",
      entityId: null,
      payload: { scheduled_for: now.toISOString() },
    }),
  prune: (db, now) => enqueueJob(db, { type: "prune", idempotencyKey: `prune:${utcDate(now)}` }),
  // `data` stays empty for a first run, and the reconcile job then falls back to its own `since`.
  reconcile: (db, now, since) =>
    enqueueJob(db, {
      type: "reconcile",
      idempotencyKey: `reconcile:${quarterHour(now)}`,
      data: since === null ? {} : { since },
    }),
  kpi_weekly: (db, now) =>
    enqueueJob(db, { type: "kpi_weekly", idempotencyKey: `kpi_weekly:${utcDate(now)}` }),
  newsletter_hygiene: (db, now) =>
    enqueueJob(db, {
      type: "newsletter_hygiene",
      idempotencyKey: `newsletter_hygiene:${utcDate(now)}`,
    }),
};

type Claim = "claimed" | "taken" | "error";

/** One guarded `claim_schedule`: `taken` when another tick moved the row first or it was switched off. */
async function claim(
  db: Db,
  key: RunnerKey,
  old: string | null,
  last: string | null,
  next: string | null,
): Promise<Claim> {
  const { data, error } = await db.rpc("claim_schedule", {
    p_key: key,
    p_guard: true,
    ...(old === null ? {} : { p_old_last_run_at: old }),
    ...(last === null ? {} : { p_last_run_at: last }),
    ...(next === null ? {} : { p_next_run_at: next }),
  });
  if (error !== null) return "error";
  return data ? "claimed" : "taken";
}

async function runSchedule(db: Db, key: RunnerKey, row: ScheduleRow, now: Date): Promise<boolean> {
  const { last_run_at: old, next_run_at: oldNext } = row;
  const next = scheduleNext(row, now).toISOString();
  if ((key === "kpi_weekly" || key === "newsletter_hygiene") && getSystemJob(key) === undefined) {
    // Only next_run_at moves, so screen 20 never shows a run that did not happen.
    // STUB(B11): kpi_weekly and newsletter_hygiene registered
    const advanced = await claim(db, key, old, old, next);
    if (advanced === "claimed") logLine("info", "schedule_not_implemented", { key });
    if (advanced === "error") logLine("warn", "schedule_claim_failed", { key });
    return false;
  }
  const claimedAt = now.toISOString();
  const claimed = await claim(db, key, old, claimedAt, next);
  if (claimed === "error") logLine("warn", "schedule_claim_failed", { key });
  if (claimed !== "claimed") return false;
  try {
    await fire[key](db, now, old);
    return true;
  } catch {
    logLine("error", "schedule_failed", { key });
    const restored = await claim(db, key, claimedAt, old, oldNext);
    if (restored !== "claimed") logLine("error", "schedule_rollback_missed", { key });
    return false;
  }
}

/** Claims each due runner schedule, then emits or enqueues its work; returns how many fired. */
export async function runDueSchedules(db: Db, now: Date): Promise<number> {
  const { data, error } = await db
    .from("schedule_settings")
    .select("key, cron, interval_days, enabled, last_run_at, next_run_at")
    .eq("enabled", true);
  if (error !== null) {
    throw new AppError(
      "unavailable",
      undefined,
      "The job system did not answer (schedule_settings).",
    );
  }
  let fired = 0;
  for (const row of data) {
    if (isRunnerKey(row.key) && isDue(row, now) && (await runSchedule(db, row.key, row, now))) {
      fired += 1;
    }
  }
  return fired;
}
