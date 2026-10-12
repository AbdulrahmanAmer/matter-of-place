import type { Dashboard } from "../../domain/admin-dashboard";
import { formatNumber } from "../../lib/format";
import { StatusPill, type Tone } from "../ui/StatusPill";

/** B14's weekly reports, `workspace/audits/YYYY-MM-DD.md`, newest date last (G11). */
export const AUDIT_REPORTS_URL =
  "https://github.com/AbdulrahmanAmer/matter-of-place/tree/main/workspace/audits";

/** The thresholds of B14's `limits.json` (ruling H33 (8)): warning from 70 percent, alert from 90. */
const WARNING_AT = 0.7;
const ALERT_AT = 0.9;

const MB = 1024 ** 2;

/** The free-plan lines our own database can measure (P-009). */
function measured(data: Dashboard) {
  return [
    { name: "Database", used: data.database_bytes, limit: 500 * MB, of: "500 MB" },
    { name: "Storage", used: data.storage.bytes, limit: 1024 * MB, of: "1 GB" },
    { name: "Mail today", used: data.email.sent_today, limit: 100, of: "100 a day" },
    { name: "Mail this month", used: data.email.sent_month, limit: 3000, of: "3,000 a month" },
  ];
}

/**
 * The vendor lines: their tokens are not Worker secrets, so the operator's laptop measures them daily
 * (`scripts/usage-push.ts`) and the dashboard shows what it recorded, with when.
 */
const vendorLines = [
  { line: "workers_requests_day", name: "Workers requests", limit: 100_000, of: "100,000 a day" },
  { line: "storage_egress", name: "Storage egress", limit: 5 * 1024 * MB, of: "5 GB a month" },
  { line: "sentry_errors", name: "Sentry errors", limit: 5000, of: "5,000 a month" },
  { line: "actions_minutes", name: "GitHub Actions minutes", limit: 2000, of: "2,000 a month" },
];

const DAY_MS = 86_400_000;

/** "today", "yesterday" or "N days ago", for when a vendor line was measured. */
function measuredAgo(at: string, now: number): string {
  const days = Math.floor((now - Date.parse(at)) / DAY_MS);
  if (days <= 0) return "measured today";
  if (days === 1) return "measured yesterday";
  return `measured ${formatNumber(days)} days ago`;
}

function level(share: number): { label: string; tone: Tone } {
  if (share >= ALERT_AT) return { label: "Alert", tone: "danger" };
  if (share >= WARNING_AT) return { label: "Warning", tone: "warning" };
  return { label: "Within limit", tone: "ok" };
}

/** The free-tier gauges of screen 2: our own numbers and the laptop's vendor readings, each as a share of its limit. */
export function GaugesTile({ data, now = Date.now() }: { data: Dashboard; now?: number }) {
  return (
    <section className="admin-gauges" aria-label="Free tier">
      <h2>Free tier</h2>
      <ul>
        {measured(data).map((gauge) => {
          const share = gauge.used / gauge.limit;
          const state = level(share);
          return (
            <li key={gauge.name} aria-label={gauge.name} data-level={state.tone}>
              <span className="admin-gauges__name">{gauge.name}</span>
              <span>
                {formatNumber(Math.round(share * 100))}% of {gauge.of}
              </span>
              <StatusPill label={state.label} tone={state.tone} />
            </li>
          );
        })}
        {vendorLines.map((line) => {
          const reading = data.vendor.find((row) => row.line === line.line);
          if (reading === undefined) {
            return (
              <li key={line.name} aria-label={line.name}>
                <span className="admin-gauges__name">{line.name}</span>
                <span>Not measured yet, of {line.of}</span>
              </li>
            );
          }
          if (reading.limit === null && reading.note !== null) {
            return (
              <li key={line.name} aria-label={line.name}>
                <span className="admin-gauges__name">{line.name}</span>
                <span>
                  {formatNumber(Math.round(reading.used))}, {reading.note}
                </span>
                <span className="admin-gauges__when">{measuredAgo(reading.measured_at, now)}</span>
              </li>
            );
          }
          const share = reading.used / (reading.limit ?? line.limit);
          const state = level(share);
          return (
            <li key={line.name} aria-label={line.name} data-level={state.tone}>
              <span className="admin-gauges__name">{line.name}</span>
              <span>
                {formatNumber(Math.round(share * 100))}% of {line.of}
              </span>
              <StatusPill label={state.label} tone={state.tone} />
              <span className="admin-gauges__when">{measuredAgo(reading.measured_at, now)}</span>
            </li>
          );
        })}
      </ul>
      <a href={AUDIT_REPORTS_URL}>Weekly audit reports</a>
    </section>
  );
}
