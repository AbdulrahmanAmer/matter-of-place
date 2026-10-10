// The free-tier table of P-009 as the daily `health` job reads it (B14 invariant 7). `workspace/audits/tools/limits.json`
// is the one place the limits and thresholds are written and `usage.mjs` reads it; this file is its mirror, because the
// Worker cannot read the workspace, and `tests/unit/audit/gauges.test.ts` fails when the two differ.

type GaugeKind = "vendor" | "info" | "guideline";
export type GaugeStatus = "ok" | "watch" | "DECISION" | "LIMIT" | "info";

export interface GaugeLine {
  line: string;
  limit: number | null;
  unit: string;
  source: string;
  kind: GaugeKind;
}

export const THRESHOLDS = { watch: 50, decision: 70, limit: 90 } as const;

export const P009_LIMITS: readonly GaugeLine[] = [
  {
    line: "workers_requests_day",
    limit: 100000,
    unit: "requests a day",
    source: "cloudflare.mjs",
    kind: "vendor",
  },
  {
    line: "workers_requests_month",
    limit: 3000000,
    unit: "requests a month (30 days of the daily limit)",
    source: "cloudflare.mjs",
    kind: "vendor",
  },
  { line: "db_bytes", limit: 524288000, unit: "bytes", source: "ours.mjs", kind: "vendor" },
  { line: "storage_bytes", limit: 1073741824, unit: "bytes", source: "ours.mjs", kind: "vendor" },
  {
    line: "storage_egress",
    limit: 5368709120,
    unit: "bytes a month",
    source: "Supabase usage report",
    kind: "vendor",
  },
  {
    line: "edge_function_calls",
    limit: 500000,
    unit: "calls a month",
    source: "Supabase usage report",
    kind: "vendor",
  },
  {
    line: "email_sent_today",
    limit: 100,
    unit: "emails a day",
    source: "ours.mjs",
    kind: "vendor",
  },
  {
    line: "email_sent_month",
    limit: 3000,
    unit: "emails a month",
    source: "ours.mjs",
    kind: "vendor",
  },
  { line: "resend_contacts", limit: 1000, unit: "contacts", source: "ours.mjs", kind: "vendor" },
  {
    line: "actions_minutes",
    limit: 2000,
    unit: "minutes a month, approximate",
    source: "github.mjs",
    kind: "vendor",
  },
  {
    line: "sentry_errors",
    limit: 5000,
    unit: "errors a month",
    source: "sentry.mjs",
    kind: "vendor",
  },
  { line: "caption_tokens", limit: null, unit: "tokens a month", source: "ours.mjs", kind: "info" },
  {
    line: "reels_month",
    limit: 10,
    unit: "reels a month",
    source: "ours.mjs",
    kind: "guideline",
  },
];

/**
 * `ok` under 50 percent, `watch` from 50, `DECISION` from 70, `LIMIT` from 90; an info line is always `info` and a
 * guideline line only `ok` or `watch` (G30, H34). Same rules as `gaugeStatus` of `usage.mjs`.
 */
export function gaugeStatus(
  line: GaugeLine,
  used: number,
): { percent: number | null; status: GaugeStatus } {
  if (line.kind === "info" || line.limit === null) return { percent: null, status: "info" };
  const percent = Math.round((used / line.limit) * 1000) / 10;
  if (line.kind === "guideline") return { percent, status: used > line.limit ? "watch" : "ok" };
  if (percent >= THRESHOLDS.limit) return { percent, status: "LIMIT" };
  if (percent >= THRESHOLDS.decision) return { percent, status: "DECISION" };
  return { percent, status: percent >= THRESHOLDS.watch ? "watch" : "ok" };
}
