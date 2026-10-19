import { formatInZone, marketTimezone } from "../../domain/market-time";

/** A day as the client's request keeps it, in its own market's time ("Oct 2, 2026 PT"). */
export const accountDay = (state: string, at: string): string =>
  formatInZone(at, marketTimezone(state === "California" ? "california" : null), "date");

/** A day with no market of its own (an invoice, a ledger line): Eastern time, as an entity with no market is. */
export const plainDay = (at: string): string => formatInZone(at, marketTimezone(null), "date");

/** A calendar day ("2026-10-08", a report's week) as it is, without moving it to another zone's evening. */
export const calendarDay = (date: string): string =>
  new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(date));

/** Whole dollars or cents as the invoice states them: "$1,250" and "$250.50". */
export function money(amount: number, currency: string): string {
  const cents = Math.round(amount * 100) % 100 !== 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

/** A count with thousands separators; a figure the platform did not report is "Not measured". */
export const count = (value: number | null): string =>
  value === null ? "Not measured" : value.toLocaleString("en-US");

/** A click-through rate stored as a fraction, as a percentage. */
export const percent = (value: number | null): string =>
  value === null ? "Not measured" : `${(value * 100).toFixed(2)}%`;
