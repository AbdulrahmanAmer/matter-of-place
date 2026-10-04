// Invariant 4 of B8: the delay before the next run of a job that failed. `fail_job` applies the same
// formula in SQL when it writes `run_after`; this is its readable twin and the outage model's clock.

const BASE_MS = 30_000;
const CAP_MS = 3_600_000;

/** `min(30 s * 2^(attempts - 1), 1 h)` with plus or minus 20 percent jitter; `rand` is in [0, 1). */
export function nextDelayMs(attempts: number, rand: number): number {
  return Math.min(BASE_MS * 2 ** (attempts - 1), CAP_MS) * (0.8 + 0.4 * rand);
}
