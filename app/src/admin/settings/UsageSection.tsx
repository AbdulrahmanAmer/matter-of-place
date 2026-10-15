import type { UsageLine } from "../../domain/admin-usage";
import { formatInZone, OFFICE_ZONE } from "../../domain/market-time";
import { formatNumber } from "../../lib/format";
import { AdminApiError } from "../ui/admin-fetch";
import { AdminPending } from "../ui/AdminPending";
import { useUsage } from "./usage-queries";

// Settings, Service usage (W7 item 7): one plain gauge per `vendor_usage` line, read only. The laptop records the
// figures (the weekly audit's collectors and the Claude runner); this shows what it last recorded, and when.

const GB = 1024 ** 3;
const MB = 1024 ** 2;

const bytes = (value: number) =>
  value >= GB ? `${(value / GB).toFixed(1)} GB` : `${formatNumber(Math.round(value / MB))} MB`;

interface Gauge {
  name: string;
  /** How a figure of this line reads. */
  amount: (value: number) => string;
  /** What the share is a share of; null when the line already says it. */
  of: string | null;
}

const count = (value: number) => formatNumber(Math.round(value));

const GAUGES: Record<UsageLine["line"], Gauge> = {
  workers_requests_day: { name: "Workers requests today", amount: count, of: "the free plan" },
  storage_egress: { name: "Storage egress this month", amount: bytes, of: "the free plan" },
  sentry_errors: { name: "Sentry errors this month", amount: count, of: "the free plan" },
  actions_minutes: { name: "Actions minutes this month", amount: count, of: "the free plan" },
  claude_week: {
    name: "Claude week",
    amount: (value) => `${count(value)}% of the week used`,
    of: null,
  },
};

function UsageRow({ line }: { line: UsageLine }) {
  const gauge = GAUGES[line.line];
  if (line.used === null || line.measured_at === null) {
    return (
      <li aria-label={gauge.name}>
        <span className="admin-usage__name">{gauge.name}</span>
        <span>Not measured yet.</span>
      </li>
    );
  }
  const used = gauge.amount(line.used);
  return (
    <li aria-label={gauge.name}>
      <span className="admin-usage__name">{gauge.name}</span>
      <span>
        {line.limit === null || gauge.of === null ? used : `${used} of ${gauge.amount(line.limit)}`}
      </span>
      {line.percent === null ? null : (
        <>
          <progress
            className="admin-usage__bar"
            value={Math.min(line.percent, 100)}
            max={100}
            aria-label={`${gauge.name}, share used`}
          />
          {gauge.of === null ? null : (
            <span className="admin-usage__share">
              {formatNumber(line.percent)}% of {gauge.of}
            </span>
          )}
        </>
      )}
      {line.note === null ? null : <span className="admin-usage__note">{line.note}</span>}
      <span className="admin-usage__when">
        Measured {formatInZone(line.measured_at, OFFICE_ZONE, "dayTime")}
      </span>
    </li>
  );
}

/** The gauges of the free plans and the Claude week, each with what was used, its limit and when it was measured. */
export function UsageSection() {
  const usage = useUsage();
  if (usage.error !== null) {
    return (
      <p role="alert">
        {usage.error.message}
        {usage.error instanceof AdminApiError && usage.error.requestId !== undefined
          ? ` Request ${usage.error.requestId}.`
          : null}
      </p>
    );
  }
  if (usage.data === undefined) return <AdminPending />;
  return (
    <ul className="admin-usage">
      {usage.data.lines.map((line) => (
        <UsageRow key={line.line} line={line} />
      ))}
    </ul>
  );
}
