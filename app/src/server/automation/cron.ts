import { CronExpressionParser } from "cron-parser";

// When a schedule row is due (B8b invariant 12). Every cron is UTC, and the time comes in as an argument (R29).
// `interval_days` counts calendar dates, not durations, so a claim a few seconds late does not slip a fortnight.

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

/** The clock columns of a `schedule_settings` row, as the database returns them. */
export interface ScheduleClock {
  cron: string;
  interval_days: number | null;
  enabled: boolean;
  last_run_at: string | null;
  next_run_at: string | null;
}

/** The first slot of `cron` strictly after `from`. */
export function nextRun(cron: string, from: Date): Date {
  return CronExpressionParser.parse(cron, { currentDate: from, tz: "UTC" }).next().toDate();
}

export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** The next run after a run at `from`: with `interval_days`, the first slot on or after that many UTC dates later. */
export function scheduleNext(row: ScheduleClock, from: Date): Date {
  if (row.interval_days === null) return nextRun(row.cron, from);
  const earliest = startOfUtcDay(from).getTime() + row.interval_days * DAY_MS;
  return nextRun(row.cron, new Date(earliest - MINUTE_MS));
}

/** A row that never ran first fires at the next slot of its cron. */
export function dueAt(row: ScheduleClock, now: Date): Date {
  if (row.next_run_at !== null) return new Date(row.next_run_at);
  if (row.last_run_at !== null) return scheduleNext(row, new Date(row.last_run_at));
  return nextRun(row.cron, new Date(now.getTime() - MINUTE_MS));
}

export function isDue(row: ScheduleClock, now: Date): boolean {
  return row.enabled && dueAt(row, now).getTime() <= now.getTime();
}
