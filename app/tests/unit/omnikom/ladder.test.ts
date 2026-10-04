import { describe, expect, it } from "vitest";
import { nextRetryAt } from "../../../src/server/omnikom/ladder";

const NOW = new Date("2026-10-04T09:30:00.000Z");
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const waitAfter = (failure: number, retryAfter?: Date) => {
  const at = nextRetryAt(failure, NOW, retryAfter);
  return at === null ? null : at.getTime() - NOW.getTime();
};

describe("nextRetryAt", () => {
  it("invariant 3: failures 1 to 6 wait 1 minute, 5 minutes, 30 minutes, 2 hours, 6 hours and 24 hours", () => {
    expect([1, 2, 3, 4, 5, 6].map((failure) => waitAfter(failure))).toEqual([
      MINUTE_MS,
      5 * MINUTE_MS,
      30 * MINUTE_MS,
      2 * HOUR_MS,
      6 * HOUR_MS,
      24 * HOUR_MS,
    ]);
  });

  it("invariant 3: the seventh failure is dead", () => {
    expect(nextRetryAt(7, NOW)).toBeNull();
  });

  it("waits for a Retry-After later than the ladder and ignores an earlier one", () => {
    expect(waitAfter(1, new Date(NOW.getTime() + 2 * HOUR_MS))).toBe(2 * HOUR_MS);
    expect(waitAfter(4, new Date(NOW.getTime() + MINUTE_MS))).toBe(2 * HOUR_MS);
  });
});
