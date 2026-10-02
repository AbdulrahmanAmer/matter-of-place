import type { LogEvent } from "./log-events.ts";

type LogLevel = "info" | "warn" | "error";
type LogValue = string | number | boolean | null;

// Bounded runs keep the match linear on a long token that holds no address.
const EMAIL = /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63})+/g;

export function maskEmails(text: string): string {
  return text.replace(EMAIL, "[email]");
}

/** One JSON line per call. `event` is a LogEvent name; ids and values go in `fields`. */
export function logLine(
  level: LogLevel,
  event: LogEvent,
  fields: Record<string, LogValue> = {},
): void {
  const masked = Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [
      key,
      typeof value === "string" ? maskEmails(value) : value,
    ]),
  );
  const line = JSON.stringify({ level, event, ...masked });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}
