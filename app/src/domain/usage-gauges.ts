import type { UsageLine } from "./admin-usage.ts";

// The one set of names, free-plan limits and levels behind every screen that shows a `vendor_usage` line: the
// dashboard's Free tier tile and Settings, Service usage (W7 item 7). The limits mirror P-009 (`server/audit/gauges.ts`,
// which the Worker's health job reads); `tests/unit/usage-gauges.test.ts` fails when they differ.

type UsageKey = UsageLine["line"];

interface UsageGauge {
  name: string;
  /** What the figure is a figure of when the line's period is not in its name; null when the name says it. */
  qualifier: string | null;
  /** The free-plan limit a line falls back to when its row records none (the Claude week is a percentage). */
  limit: number;
}

/** A vendor line also carries its limit in words, as the dashboard tile writes it; the Claude week's tile has none. */
interface VendorGauge extends UsageGauge {
  of: string;
}

export const usageGauges: Record<Exclude<UsageKey, "claude_week">, VendorGauge> &
  Record<"claude_week", UsageGauge> = {
  workers_requests_day: {
    name: "Workers requests",
    qualifier: "last measured day",
    limit: 100_000,
    of: "100,000 a day",
  },
  storage_egress: {
    name: "Storage egress",
    qualifier: null,
    limit: 5 * 1024 ** 3,
    of: "5 GB a month",
  },
  sentry_errors: { name: "Sentry errors", qualifier: null, limit: 5000, of: "5,000 a month" },
  actions_minutes: {
    name: "GitHub Actions minutes",
    qualifier: null,
    limit: 2000,
    of: "2,000 a month",
  },
  claude_week: { name: "Claude week", qualifier: null, limit: 100 },
};

/** The lines the laptop's daily push records for the free vendor plans (the Claude week has its own runner). */
export const vendorUsageKeys: readonly Exclude<UsageKey, "claude_week">[] = [
  "workers_requests_day",
  "storage_egress",
  "sentry_errors",
  "actions_minutes",
];

/** The thresholds of B14's `limits.json` (ruling H33 (8)): warning from 70 percent, alert from 90. */
const GAUGE_WARNING_AT = 0.7;
const GAUGE_ALERT_AT = 0.9;

interface GaugeLevel {
  label: "Alert" | "Warning" | "Within limit";
  tone: "danger" | "warning" | "ok";
}

/** The level of a share of a limit (0.7 is 70 percent), the same on every screen. */
export function gaugeLevel(share: number): GaugeLevel {
  if (share >= GAUGE_ALERT_AT) return { label: "Alert", tone: "danger" };
  if (share >= GAUGE_WARNING_AT) return { label: "Warning", tone: "warning" };
  return { label: "Within limit", tone: "ok" };
}

/**
 * The limit a recorded line is measured against: its own when the row records one, else the free-plan limit above.
 * A vendor line that records no limit but a note is one the plan does not limit (a public repository's Actions
 * minutes): null, so no share and no level are shown.
 */
export function gaugeLimit(
  line: UsageKey,
  recorded: number | null,
  note: string | null,
): number | null {
  if (recorded !== null) return recorded;
  if (line !== "claude_week" && note !== null) return null;
  return usageGauges[line].limit;
}

/**
 * When the Claude week resets: the runner records it as an ISO timestamp in the note of the `claude_week` row. Null when
 * there is no note or it is not a timestamp. Settings reads the note only through this; the Office header still gets
 * the raw note from `server/workforce/service.ts` (`allowance.resets_at`), which moves here with the W6 follow-up.
 */
export function claudeWeekResetAt(note: string | null): string | null {
  if (note === null || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(note)) return null;
  return Number.isNaN(Date.parse(note)) ? null : note;
}
