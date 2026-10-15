import { formatInZone, marketTimezone } from "../../domain/market-time";

// Matter's panel (remade 2026-10-15): times read the way a person says them. A line from a minute ago is "just now",
// not "Oct 13, 2026, 11:40 AM ET"; anything older than a day keeps its date and the operator's zone.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** "just now", "4 min ago", "2 h ago", then the day and time in the operator's zone. */
export function ago(iso: string, now: number): string {
  const elapsed = now - Date.parse(iso);
  if (elapsed < MINUTE) return "just now";
  if (elapsed < HOUR) return `${String(Math.floor(elapsed / MINUTE))} min ago`;
  if (elapsed < 24 * HOUR) return `${String(Math.floor(elapsed / HOUR))} h ago`;
  return formatInZone(iso, marketTimezone(null), "dayTime");
}

/** How long something took or has been running: "12 s", "3 min", "1 h 5 min". */
export function took(fromIso: string, toIso: string | null, now: number): string {
  const end = toIso === null ? now : Date.parse(toIso);
  const seconds = Math.max(0, Math.round((end - Date.parse(fromIso)) / 1000));
  if (seconds < 60) return `${String(seconds)} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${String(minutes)} min`;
  const rest = minutes % 60;
  return rest === 0
    ? `${String(Math.floor(minutes / 60))} h`
    : `${String(Math.floor(minutes / 60))} h ${String(rest)} min`;
}
