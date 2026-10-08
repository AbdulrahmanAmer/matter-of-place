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

/** The vendor lines only the weekly audit measures: their tokens are not Worker secrets. */
const vendorLines = [
  { name: "Workers requests", of: "100,000 a day" },
  { name: "Storage egress", of: "5 GB a month" },
  { name: "Sentry errors", of: "5,000 a month" },
  { name: "GitHub Actions minutes", of: "2,000 a month" },
];

function level(share: number): { label: string; tone: Tone } {
  if (share >= ALERT_AT) return { label: "Alert", tone: "danger" };
  if (share >= WARNING_AT) return { label: "Warning", tone: "warning" };
  return { label: "Within limit", tone: "ok" };
}

/** The free-tier gauges of screen 2: our own numbers as a share of each limit, and the vendor lines unmeasured. */
export function GaugesTile({ data }: { data: Dashboard }) {
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
        {vendorLines.map((line) => (
          <li key={line.name} aria-label={line.name}>
            <span className="admin-gauges__name">{line.name}</span>
            <span>Not measured, of {line.of}</span>
          </li>
        ))}
      </ul>
      <a href={AUDIT_REPORTS_URL}>Weekly audit reports</a>
    </section>
  );
}
