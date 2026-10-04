import { describe, expect, it } from "vitest";
import { nextDelayMs } from "../../../src/server/jobs/backoff";

const MINUTE_MS = 60_000;
const PROVIDER_MAX_ATTEMPTS = 12;
const DEFAULT_MAX_ATTEMPTS = 5;
const RANDS = [0, 0.5, 0.999];

type Outcome = { status: "done" | "dead"; attempts: number; at: number };

// A provider that fails every call before `outageMs` on a simulated clock. Each failure uses one attempt
// and waits `nextDelayMs`; `attempts >= max_attempts` is dead, as `fail_job` decides (invariant 4).
function runThroughOutage(maxAttempts: number, outageMs: number, rand: number): Outcome {
  let at = 0;
  let attempts = 0;
  while (at < outageMs) {
    attempts += 1;
    if (attempts >= maxAttempts) return { status: "dead", attempts, at };
    at += nextDelayMs(attempts, rand);
  }
  return { status: "done", attempts, at };
}

describe("nextDelayMs", () => {
  it("doubles from 30 seconds", () => {
    expect([1, 2, 3, 4].map((attempts) => nextDelayMs(attempts, 0.5))).toEqual([
      30_000, 60_000, 120_000, 240_000,
    ]);
  });

  it("caps the delay at one hour", () => {
    expect(nextDelayMs(8, 0.5)).toBe(3_600_000);
    expect(nextDelayMs(20, 0.5)).toBe(3_600_000);
  });

  it("jitters by plus or minus 20 percent", () => {
    expect(nextDelayMs(1, 0)).toBe(24_000);
    expect(nextDelayMs(1, 1)).toBeCloseTo(36_000);
  });
});

describe("outage", () => {
  it.each(RANDS)(
    "a job with max_attempts 12 survives a 60 minute outage and its first attempt after recovery succeeds (rand %s)",
    (rand) => {
      const outcome = runThroughOutage(PROVIDER_MAX_ATTEMPTS, 60 * MINUTE_MS, rand);
      expect(outcome.status).toBe("done");
      expect(outcome.attempts).toBeLessThan(PROVIDER_MAX_ATTEMPTS);
      expect(outcome.at).toBeGreaterThanOrEqual(60 * MINUTE_MS);
    },
  );

  it.each(RANDS)(
    "a job with max_attempts 5 is dead after its fifth failure during the outage (rand %s)",
    (rand) => {
      expect(runThroughOutage(DEFAULT_MAX_ATTEMPTS, 60 * MINUTE_MS, rand)).toMatchObject({
        status: "dead",
        attempts: 5,
      });
    },
  );
});
