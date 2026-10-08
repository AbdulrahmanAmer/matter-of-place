import { formatInZone } from "../../domain/market-time";
import type { Report } from "../../domain/reports";
import { formatNumber } from "../../lib/format";
import type { Tone } from "../ui/StatusPill";

// How screen 22 words a figure. A figure the system does not measure is said so, never written as 0 (INT-08).

export const NOT_MEASURED = "Not measured";

/** A count with separators, or the words for a figure the platform did not return. */
export const count = (value: number | null | undefined): string =>
  value === null || value === undefined ? NOT_MEASURED : formatNumber(value);

/** A ratio as a percentage with one decimal. */
export const percent = (ratio: number | null): string =>
  ratio === null ? NOT_MEASURED : `${(ratio * 100).toFixed(1)}%`;

const day = (date: string) => formatInZone(`${date}T00:00:00Z`, "UTC", "date").replace(" UTC", "");

/** `Oct 5, 2026 to Oct 11, 2026`: an ISO week, Monday to Sunday, in UTC. */
export const weekLabel = (report: Pick<Report, "period_start" | "period_end">): string =>
  `${day(report.period_start)} to ${day(report.period_end)}`;

export type ReportState = "none" | "partial" | "complete";

export const stateLabel: Record<ReportState, string> = {
  none: "No data",
  partial: "Partial",
  complete: "Complete",
};

export const stateTone: Record<ReportState, Tone> = {
  none: "neutral",
  partial: "warning",
  complete: "ok",
};

/**
 * No data: nothing was counted that week. Partial: a channel posted but returned no views, so its figures are
 * missing from the totals. Complete: everything the system measures is there.
 */
export function reportState(report: Report): ReportState {
  if (report.impressions === 0 && report.reach === 0 && report.clicks === 0) return "none";
  const missing = Object.values(report.channel_mix).some(
    (figures) => (figures["posts"] ?? 0) > 0 && figures["views"] === undefined,
  );
  return missing ? "partial" : "complete";
}
