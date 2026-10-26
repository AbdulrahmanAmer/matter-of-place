import { formatInZone, marketTimezone } from "../../domain/market-time";
import { formatNumber } from "../../lib/format";

/** A day as the client's request keeps it, in its own market's time ("Oct 2, 2026 PT"). */
export const accountDay = (state: string, at: string): string =>
  formatInZone(at, marketTimezone(state === "California" ? "california" : null), "date");

/** A day with no market of its own (an invoice, a ledger line): Eastern time, as an entity with no market is. */
export const plainDay = (at: string): string => formatInZone(at, marketTimezone(null), "date");

/** A count with thousands separators; a figure the platform did not report is "Not measured". */
export const count = (value: number | null): string =>
  value === null ? "Not measured" : formatNumber(value);

/** A click-through rate stored as a fraction, as a percentage. */
export const percent = (value: number | null): string =>
  value === null ? "Not measured" : `${(value * 100).toFixed(2)}%`;
