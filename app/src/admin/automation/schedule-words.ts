// W3 stage 3: a clock read and set in words and in Cairo time, never as cron. The database keeps a UTC cron; this file
// turns the common shapes (every N minutes, every day at a time, every week on a day at a time) into a sentence and
// back, at the Cairo offset of the moment it is read. A cron of any other shape stays as it is and says so.

import { OFFICE_ZONE, formatInZone, offsetMinutes } from "../../domain/market-time";

export const scheduleNames: Record<string, { name: string; about: string }> = {
  digest: {
    name: "Place Notes sending",
    about: "Sends the newsletter issue to everyone signed up.",
  },
  audit: {
    name: "Saturday audit",
    about: "Checks the site's speed, search health and pages, and writes a report.",
  },
  backup: { name: "Database backup", about: "Copies the whole database to safe storage." },
  keepwarm: {
    name: "Keep the site quick",
    about: "Visits the site so the first reader never waits.",
  },
  kpi_weekly: {
    name: "Weekly numbers",
    about: "Collects the week's figures for the reports page.",
  },
  newsletter_hygiene: {
    name: "Mailing list care",
    about: "Removes addresses that bounce or never confirmed.",
  },
  prune: { name: "Nightly clean-up", about: "Deletes what the retention rules say has expired." },
  reconcile: { name: "Upload check", about: "Matches uploaded files with their records." },
};

export function scheduleName(key: string): string {
  return scheduleNames[key]?.name ?? key.replace(/_/g, " ");
}

export const weekdays = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export type Cadence =
  | { kind: "minutes"; every: number }
  | { kind: "daily"; hour: number; minute: number }
  | { kind: "weekly"; day: number; hour: number; minute: number }
  | { kind: "other" };

const whole = (text: string, low: number, high: number): number | null => {
  if (!/^\d{1,2}$/.test(text)) return null;
  const value = Number(text);
  return value >= low && value <= high ? value : null;
};

/** The shape of a five-field cron, read as UTC. */
export function cadenceOf(cron: string): Cadence {
  const [minute = "", hour = "", dayOfMonth = "", month = "", dayOfWeek = "", ...rest] = cron
    .trim()
    .split(/\s+/);
  if (rest.length > 0 || dayOfMonth !== "*" || month !== "*") return { kind: "other" };
  const step = /^\*\/(\d{1,2})$/.exec(minute);
  if (step?.[1] !== undefined && hour === "*" && dayOfWeek === "*") {
    const every = whole(step[1], 1, 59);
    return every === null ? { kind: "other" } : { kind: "minutes", every };
  }
  const m = whole(minute, 0, 59);
  const h = whole(hour, 0, 23);
  if (m === null || h === null) return { kind: "other" };
  if (dayOfWeek === "*") return { kind: "daily", hour: h, minute: m };
  const day = whole(dayOfWeek, 0, 6);
  return day === null ? { kind: "other" } : { kind: "weekly", day, hour: h, minute: m };
}

/** Minutes Cairo is ahead of UTC at `at` (180 in summer, 120 in winter). */
export function officeOffset(at: Date): number {
  return offsetMinutes(at.getTime(), OFFICE_ZONE);
}

/** Moves a daily or weekly cadence by `minutes`, carrying into the next or previous day. */
function shift(cadence: Cadence, minutes: number): Cadence {
  if (cadence.kind !== "daily" && cadence.kind !== "weekly") return cadence;
  const total = cadence.hour * 60 + cadence.minute + minutes;
  const dayShift = Math.floor(total / 1440);
  const inDay = ((total % 1440) + 1440) % 1440;
  const hour = Math.floor(inDay / 60);
  const minute = inDay % 60;
  if (cadence.kind === "daily") return { kind: "daily", hour, minute };
  return { kind: "weekly", day: (((cadence.day + dayShift) % 7) + 7) % 7, hour, minute };
}

/** The UTC cadence as Cairo wall time today. */
export function toOffice(cadence: Cadence, now: Date = new Date()): Cadence {
  return shift(cadence, officeOffset(now));
}

/** A Cairo cadence as the UTC cron the database keeps. */
export function cronOf(cadence: Cadence, now: Date = new Date()): string | null {
  if (cadence.kind === "minutes") return `*/${String(cadence.every)} * * * *`;
  if (cadence.kind === "other") return null;
  const utc = shift(cadence, -officeOffset(now));
  if (utc.kind === "daily") return `${String(utc.minute)} ${String(utc.hour)} * * *`;
  if (utc.kind === "weekly")
    return `${String(utc.minute)} ${String(utc.hour)} * * ${String(utc.day)}`;
  return null;
}

const clock = (hour: number, minute: number) =>
  `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;

/** "Every Saturday at 15:00, Cairo time"; a cron of another shape is named as such. */
export function sayCadence(
  cron: string,
  intervalDays: number | null,
  now: Date = new Date(),
): string {
  const local = toOffice(cadenceOf(cron), now);
  if (local.kind === "minutes")
    return local.every === 1 ? "Every minute" : `Every ${String(local.every)} minutes`;
  if (local.kind === "other") return `On a custom timetable (${cron}, UTC)`;
  const at = `at ${clock(local.hour, local.minute)}, Cairo time`;
  if (local.kind === "daily") return `Every day ${at}`;
  const day = weekdays[local.day] ?? "";
  if (intervalDays !== null && intervalDays > 1)
    return `Every ${String(intervalDays)} days, on a ${day} ${at}`;
  return `Every ${day} ${at}`;
}

/** A moment as the office reads it: "Sat, Oct 17, 15:00 Cairo time". */
export function officeTime(iso: string): string {
  return formatInZone(iso, OFFICE_ZONE, "dayTime");
}

export { clock };
