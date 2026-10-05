import { describe, expect, it } from "vitest";
import {
  dueAt,
  isDue,
  nextRun,
  scheduleNext,
  startOfUtcDay,
  type ScheduleClock,
} from "../../../src/server/automation/cron";

const at = (iso: string) => new Date(iso);

function row(overrides: Partial<ScheduleClock>): ScheduleClock {
  return {
    cron: "*/15 * * * *",
    interval_days: null,
    enabled: true,
    last_run_at: null,
    next_run_at: null,
    ...overrides,
  };
}

const reconcile = row({ last_run_at: "2026-10-04T10:00:00.000Z" });
const digest = row({
  cron: "0 14 * * 2",
  interval_days: 14,
  last_run_at: "2026-10-07T10:00:00.000Z",
});

describe("nextRun and startOfUtcDay", () => {
  it("nextRun gives the first UTC slot strictly after from", () => {
    expect(nextRun("*/15 * * * *", at("2026-10-04T10:15:00Z")).toISOString()).toBe(
      "2026-10-04T10:30:00.000Z",
    );
    expect(nextRun("0 14 * * 2", at("2026-10-04T10:00:00Z")).toISOString()).toBe(
      "2026-10-06T14:00:00.000Z",
    );
  });

  it("startOfUtcDay drops the time of day in UTC", () => {
    expect(startOfUtcDay(at("2026-10-27T23:59:59.999Z")).toISOString()).toBe(
      "2026-10-27T00:00:00.000Z",
    );
  });
});

describe("isDue (invariant 12)", () => {
  it("reconcile with last_run_at 10:00 is due at 10:15 and not at 10:07", () => {
    expect(isDue(reconcile, at("2026-10-04T10:07:00Z"))).toBe(false);
    expect(isDue(reconcile, at("2026-10-04T10:15:00Z"))).toBe(true);
  });

  it("digest every 14 days is due at the first Tuesday 14:00 on or after the date", () => {
    expect(isDue(digest, at("2026-10-13T14:00:00Z"))).toBe(false);
    expect(isDue(digest, at("2026-10-21T00:01:00Z"))).toBe(false);
    expect(isDue(digest, at("2026-10-27T13:59:00Z"))).toBe(false);
    expect(isDue(digest, at("2026-10-27T14:00:00Z"))).toBe(true);
  });

  it("a row that never ran is due at the next slot of its cron and not before", () => {
    const fresh = row({});
    expect(isDue(fresh, at("2026-10-04T10:14:59Z"))).toBe(false);
    expect(isDue(fresh, at("2026-10-04T10:15:00Z"))).toBe(true);
    expect(isDue(fresh, at("2026-10-04T10:15:40Z"))).toBe(true);
    expect(dueAt(fresh, at("2026-10-04T10:07:00Z")).toISOString()).toBe("2026-10-04T10:15:00.000Z");
  });

  it("a tick 3 minutes late still finds the slot due once", () => {
    const late = at("2026-10-04T10:18:00Z");
    expect(isDue(reconcile, late)).toBe(true);
    const claimed = row({
      last_run_at: late.toISOString(),
      next_run_at: scheduleNext(reconcile, late).toISOString(),
    });
    expect(isDue(claimed, at("2026-10-04T10:19:00Z"))).toBe(false);
    expect(isDue(claimed, at("2026-10-04T10:30:00Z"))).toBe(true);
  });

  it("a stored next_run_at decides, and a switched-off row is never due", () => {
    const stored = row({ last_run_at: null, next_run_at: "2026-10-04T11:00:00.000Z" });
    expect(isDue(stored, at("2026-10-04T10:45:00Z"))).toBe(false);
    expect(isDue(stored, at("2026-10-04T11:00:00Z"))).toBe(true);
    expect(isDue({ ...stored, enabled: false }, at("2026-10-04T11:00:00Z"))).toBe(false);
  });
});

describe("scheduleNext (invariant 12)", () => {
  it("a digest claim at 2026-10-27T14:00:05Z runs next on 2026-11-10 at 14:00", () => {
    expect(scheduleNext(digest, at("2026-10-27T14:00:05Z")).toISOString()).toBe(
      "2026-11-10T14:00:00.000Z",
    );
  });

  it("without interval_days the next run is the next cron slot", () => {
    expect(scheduleNext(reconcile, at("2026-10-04T10:15:02Z")).toISOString()).toBe(
      "2026-10-04T10:30:00.000Z",
    );
  });
});
