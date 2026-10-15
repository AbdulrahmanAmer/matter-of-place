import { formatInZone, marketTimezone } from "../../domain/market-time";

// W7 item 4: how the team's memory writes dates. A day the daily meeting names ("2026-10-15") has no zone: it is
// shown as that day, never moved by the reader's clock. A moment keeps the operator's zone, as the rest of the console.

/** "Oct 15, 2026" for a date with no time: noon UTC read in UTC is the same day everywhere. */
export const dayOf = (date: string): string =>
  formatInZone(`${date}T12:00:00Z`, "UTC", "date").replace(/ UTC$/, "");

/** "Oct 15, 2026 ET" for a moment, or "Never" when there is none. */
export const momentOf = (iso: string | null): string =>
  iso === null ? "Never" : formatInZone(iso, marketTimezone(null), "date");
