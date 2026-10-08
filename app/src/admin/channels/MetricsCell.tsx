import { formatNumber } from "../../lib/format";

// The numbers the platforms gave back, in the order of the normalised metrics (B10 Outputs). A field the platform did
// not return is null in the row and is left out here, never shown as 0.
const FIELDS = [
  ["reach", "Reach"],
  ["views", "Views"],
  ["likes", "Likes"],
  ["comments", "Comments"],
  ["saves", "Saves"],
  ["shares", "Shares"],
  ["clicks", "Clicks"],
] as const;

export function MetricsCell({ metrics }: { metrics: Readonly<Record<string, unknown>> }) {
  const shown = FIELDS.flatMap(([field, label]) => {
    const value = metrics[field];
    return typeof value === "number" ? [`${label} ${formatNumber(value)}`] : [];
  });
  return shown.length === 0 ? <span>None yet</span> : <span>{shown.join(", ")}</span>;
}
