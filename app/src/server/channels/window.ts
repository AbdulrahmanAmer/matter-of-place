import type { ChannelSettings } from "../../domain/automation.ts";
import { toUtc } from "../../domain/market-time.ts";
import { nextDelayMs } from "../jobs/backoff.ts";
import { AppError } from "../lib/errors.ts";

// The posting window of a channel (B10 invariants 3 and 3a). `days`, `from` and `to` are wall time in `tz`, so a
// window keeps its local hours across daylight saving; `daily_cap` counts the channel's posts of the local day.

type PostingWindow = ChannelSettings["posting_window"];

/** The local calendar date of `now` in `tz`, as UTC midnight of that date (calendar arithmetic only). */
function localDate(now: Date, tz: string): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const field = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return new Date(Date.UTC(field("year"), field("month") - 1, field("day")));
}

/** The window of the local date `date` as UTC instants, or null when the window is closed that weekday. */
function windowOn(date: Date, window: PostingWindow): { start: Date; end: Date } | null {
  if (!window.days.includes(date.getUTCDay() || 7)) return null;
  const day = date.toISOString().slice(0, 10);
  return {
    start: new Date(toUtc(`${day}T${window.from}`, window.tz)),
    end: new Date(toUtc(`${day}T${window.to}`, window.tz)),
  };
}

const addDays = (date: Date, days: number) => new Date(date.getTime() + days * 86_400_000);

/** Today's window when `now` is inside it and the cap has room, else null. */
function openWindow(now: Date, window: PostingWindow, alreadyPostedToday: number) {
  if (alreadyPostedToday >= window.daily_cap) return null;
  const today = windowOn(localDate(now, window.tz), window);
  return today !== null && today.start <= now && now < today.end ? today : null;
}

/** The first window start after `now`; today's counts only while the cap has room. */
function nextOpening(now: Date, window: PostingWindow, alreadyPostedToday: number): Date {
  const today = localDate(now, window.tz);
  // Eight local dates reach the same weekday a week on, so a one-day window whose cap is spent today is found.
  for (let offset = 0; offset <= 7; offset += 1) {
    if (offset === 0 && alreadyPostedToday >= window.daily_cap) continue;
    const slot = windowOn(addDays(today, offset), window);
    if (slot !== null && slot.start > now) return slot.start;
  }
  throw new AppError("server", undefined, "The posting window has no day.");
}

/** `now` when it is inside the window and the daily cap has room, otherwise the next window start. */
export function nextWindowSlot(now: Date, window: PostingWindow, alreadyPostedToday: number): Date {
  return openWindow(now, window, alreadyPostedToday) === null
    ? nextOpening(now, window, alreadyPostedToday)
    : now;
}

/**
 * What a retryable failure does (invariant 3a). When the latest time B8's backoff can run the job again is still
 * inside today's window and the cap has room, the job retries there (`moved: false`); otherwise, or on the last
 * attempt, it moves to the next window start (`moved: true`) so it is never dead-lettered.
 */
export function planRetry(
  now: Date,
  window: PostingWindow,
  alreadyPostedToday: number,
  attempt: number,
  maxAttempts: number,
): { at: Date; moved: boolean } {
  const retryAt = new Date(now.getTime() + nextDelayMs(attempt, 1));
  const today = openWindow(now, window, alreadyPostedToday);
  if (attempt < maxAttempts && today !== null && retryAt < today.end) {
    return { at: retryAt, moved: false };
  }
  return { at: nextOpening(now, window, alreadyPostedToday), moved: true };
}
