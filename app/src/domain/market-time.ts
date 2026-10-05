// Time on admin screens (GD-06). The database stores UTC; a timestamp is shown in its market's zone with
// the zone named, and a time an editor types is read in a zone and converted to UTC on the way in.

const PACIFIC = "America/Los_Angeles";
const EASTERN = "America/New_York";

const SUFFIX: Readonly<Record<string, string>> = { [PACIFIC]: "PT", [EASTERN]: "ET" };

/** California is Pacific; New York, Florida and an entity with no market are Eastern. */
export function marketTimezone(marketSlug: string | null | undefined): string {
  return marketSlug === "california" ? PACIFIC : EASTERN;
}

const STYLES = {
  date: { dateStyle: "medium" },
  datetime: { dateStyle: "medium", timeStyle: "short" },
  time: { timeStyle: "short" },
} as const satisfies Record<string, Intl.DateTimeFormatOptions>;

export type TimeStyle = keyof typeof STYLES;

/** `utcIso` in `zone`, followed by `PT`, `ET` or, for any other zone, its IANA name. */
export function formatInZone(utcIso: string, zone: string, style: TimeStyle): string {
  const text = new Intl.DateTimeFormat("en-US", { ...STYLES[style], timeZone: zone }).format(
    new Date(utcIso),
  );
  return `${text} ${SUFFIX[zone] ?? zone}`;
}

const LOCAL_INPUT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/** Minutes `zone` is ahead of UTC at the instant `utcMs`. */
function offsetMinutes(utcMs: number, zone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(utcMs));
  const field = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  const wall = Date.UTC(
    field("year"),
    field("month") - 1,
    field("day"),
    field("hour"),
    field("minute"),
  );
  return Math.round((wall - Math.floor(utcMs / 60_000) * 60_000) / 60_000);
}

/**
 * A wall time typed as `YYYY-MM-DDTHH:mm` (an `<input type="datetime-local">` value) read in `zone`, as an
 * ISO UTC instant. A time the spring change skips is read with the offset before the change, so it moves
 * forward by the hour; a time the autumn change repeats is the first of the two.
 */
export function toUtc(localInput: string, zone: string): string {
  const match = LOCAL_INPUT.exec(localInput);
  if (match === null) throw new RangeError(`not a local date and time: ${localInput}`);
  const [, year, month, day, hour, minute] = match.map(Number);
  const wall = Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1, hour ?? 0, minute ?? 0);
  const before = wall - offsetMinutes(wall - 86_400_000, zone) * 60_000;
  const after = wall - offsetMinutes(wall + 86_400_000, zone) * 60_000;
  const candidates = [before, after].filter(
    (utc) => offsetMinutes(utc, zone) * 60_000 === wall - utc,
  );
  return new Date(candidates.length > 0 ? Math.min(...candidates) : before).toISOString();
}
