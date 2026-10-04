const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/** B15 invariant 3: the wait after failures 1 to 6. Partners are down for hours, so this outlasts B8's backoff. */
const DELAYS_MS = [
  MINUTE_MS,
  5 * MINUTE_MS,
  30 * MINUTE_MS,
  2 * HOUR_MS,
  6 * HOUR_MS,
  24 * HOUR_MS,
];

/** When to try again after failure `failureNumber`, never before `retryAfter`; null when the delivery is dead. */
export function nextRetryAt(failureNumber: number, now: Date, retryAfter?: Date): Date | null {
  const delay = DELAYS_MS[failureNumber - 1];
  if (delay === undefined) return null;
  const at = now.getTime() + delay;
  return new Date(retryAfter === undefined ? at : Math.max(at, retryAfter.getTime()));
}
