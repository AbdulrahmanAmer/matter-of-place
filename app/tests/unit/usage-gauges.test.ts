import { describe, expect, it } from "vitest";
import { P009_LIMITS } from "../../src/server/audit/gauges";
import {
  claudeWeekResetAt,
  gaugeLevel,
  gaugeLimit,
  usageGauges,
  vendorUsageKeys,
} from "../../src/domain/usage-gauges";

// W7 item 7 (review follow-up): the one set of names, limits and levels the dashboard tile and Settings, Service usage
// both read, and the one reading of the Claude week's reset time.

describe("the free-plan limits of the usage gauges", () => {
  it("are the P-009 limits the health job reads", () => {
    const p009 = new Map(P009_LIMITS.map((entry) => [entry.line, entry.limit]));
    expect(vendorUsageKeys.map((line) => [line, usageGauges[line].limit, p009.get(line)])).toEqual(
      vendorUsageKeys.map((line) => [line, p009.get(line), p009.get(line)]),
    );
  });
});

describe("gaugeLevel", () => {
  it("is within the limit under 70 percent, a warning from 70 and an alert from 90", () => {
    expect([0.69, 0.7, 0.89, 0.9, 1.25].map((share) => gaugeLevel(share))).toEqual([
      { label: "Within limit", tone: "ok" },
      { label: "Warning", tone: "warning" },
      { label: "Warning", tone: "warning" },
      { label: "Alert", tone: "danger" },
      { label: "Alert", tone: "danger" },
    ]);
  });
});

describe("gaugeLimit", () => {
  it("keeps the limit a row records, falls back to the free plan when it records none", () => {
    expect([
      gaugeLimit("sentry_errors", 100, null),
      gaugeLimit("sentry_errors", null, null),
      gaugeLimit("claude_week", null, null),
    ]).toEqual([100, 5000, 100]);
  });

  it("leaves a vendor line with a note and no limit unlimited, but never the Claude week", () => {
    expect([
      gaugeLimit("actions_minutes", null, "public repository, not limited"),
      gaugeLimit("claude_week", null, "2026-10-21T16:00:00.000Z"),
    ]).toEqual([null, 100]);
  });
});

describe("claudeWeekResetAt", () => {
  it("returns the ISO time the runner records, and null for no note or a note that is not a time", () => {
    expect([
      claudeWeekResetAt("2026-10-21T16:00:00.000Z"),
      claudeWeekResetAt(null),
      claudeWeekResetAt("Resets Sat, Oct 17"),
      claudeWeekResetAt("2026-13-45T99:99:00.000Z"),
    ]).toEqual(["2026-10-21T16:00:00.000Z", null, null, null]);
  });
});
