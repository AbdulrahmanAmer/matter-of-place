// Hand-written Sentry envelope client (ASSUMED over `@sentry/cloudflare`: the free Worker has
// 10 ms of CPU). The job runner loads it under Deno, so it imports only `./log.ts`.
import { logLine, maskEmails } from "./log.ts";

type Level = "error" | "warning";
type Side = "worker" | "job-runner" | "browser";

export interface CaptureOptions {
  /** The client key's DSN; without one nothing is sent. */
  dsn: string | undefined;
  requestId: string;
  route: string;
  env: string;
  release: string;
  fingerprint?: string[];
  level?: Level;
  side?: Side;
}

interface StackFrame {
  function: string;
  filename: string;
  lineno: number;
  colno: number;
}

interface SentryException {
  type: string;
  value: string;
  stacktrace: { frames: StackFrame[] };
}

export interface SentryEvent {
  event_id: string;
  timestamp: number;
  platform: "javascript";
  level: Level;
  release: string;
  environment: string;
  tags: Record<string, string>;
  fingerprint?: string[];
  message?: string;
  exception?: { values: SentryException[] };
  sdk?: typeof SDK;
  // What an SDK or a fallback could add. scrubEvent lets none of it through (GS-03); its
  // `user` is only the empty geo object below.
  user?: unknown;
  request?: unknown;
  contexts?: unknown;
  breadcrumbs?: unknown;
}

// Sentry infers the sender's IP for a javascript event unless the SDK settings forbid it
// (measured 2026-10-02: the first stored test event carried `user.ip_address` and geo).
const SDK = { name: "mop.envelope", version: "1", settings: { infer_ip: "never" } } as const;

// Relay looks up geo from the connection IP unless the event already holds a geo object
// (relay-event-normalization `normalize_user_geoinfo`), so an empty one keeps city and country out.
const NO_GEO = { geo: {} } as const;

// ASSUMED limit (invariant 7).
const MAX_VALUE = 200;
// One event per fingerprint per window in each isolate (INT-12).
const WINDOW_MS = 60_000;
const SEND_TIMEOUT_MS = 2_000;

const lastSent = new Map<string, number>();
let pausedUntil = 0;

const scrubText = (text: string, max = Infinity) => maskEmails(text).slice(0, max);

/**
 * Applied last, in the role of `beforeSend`. Only an allow-list of fields survives, so user,
 * IP, request data, cookies, headers, query string, geo and breadcrumbs never leave.
 */
export function scrubEvent(event: SentryEvent): SentryEvent {
  return {
    event_id: event.event_id,
    timestamp: event.timestamp,
    platform: event.platform,
    sdk: SDK,
    user: NO_GEO,
    level: event.level,
    release: scrubText(event.release),
    environment: scrubText(event.environment),
    tags: Object.fromEntries(
      Object.entries(event.tags).map(([name, value]) => [name, scrubText(value)]),
    ),
    ...(event.fingerprint && { fingerprint: event.fingerprint.map((part) => scrubText(part)) }),
    ...(event.message !== undefined && { message: scrubText(event.message, MAX_VALUE) }),
    ...(event.exception && {
      exception: {
        values: event.exception.values.map((value) => ({
          type: scrubText(value.type),
          value: scrubText(value.value, MAX_VALUE),
          stacktrace: {
            frames: value.stacktrace.frames.map((frame) => ({
              function: scrubText(frame.function),
              filename: scrubText(frame.filename),
              lineno: frame.lineno,
              colno: frame.colno,
            })),
          },
        })),
      },
    }),
  };
}

const FRAME = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/;

/** Frames of a V8 stack, the throwing frame first. */
function framesOf(stack: string | undefined): StackFrame[] {
  return (stack ?? "").split("\n").flatMap((line) => {
    const match = FRAME.exec(line);
    return match
      ? [
          {
            function: match[1] ?? "?",
            filename: match[2] ?? "?",
            lineno: Number(match[3]),
            colno: Number(match[4]),
          },
        ]
      : [];
  });
}

/**
 * What a thrown value says about itself. Reading it can throw (a null-prototype object, a
 * throwing getter, a proxy), and then the event carries a fixed text instead.
 */
function describeThrown(error: unknown): { type: string; value: string; stack?: string } {
  try {
    if (!(error instanceof Error)) return { type: typeof error, value: String(error) };
    // Plain JavaScript can put any value in these fields.
    const { name, message, stack }: { name: unknown; message: unknown; stack?: unknown } = error;
    return {
      type: String(name),
      value: String(message),
      ...(typeof stack === "string" && { stack }),
    };
  } catch {
    return { type: typeof error, value: "unprintable value" };
  }
}

function parseDsn(dsn: string): { url: string; key: string } | null {
  try {
    const url = new URL(dsn);
    const project = url.pathname.split("/").filter(Boolean).at(-1);
    if (!url.username || !project) return null;
    return { url: `${url.protocol}//${url.host}/api/${project}/envelope/`, key: url.username };
  } catch {
    return null;
  }
}

/** Seconds named by a 429 `Retry-After` or the longest window of `X-Sentry-Rate-Limits`. */
function pauseSeconds(response: Response): number {
  const limits = response.headers.get("x-sentry-rate-limits");
  if (limits !== null) {
    return Math.max(0, ...limits.split(",").map((limit) => Number.parseInt(limit, 10) || 0));
  }
  if (response.status === 429) {
    return Number.parseInt(response.headers.get("retry-after") ?? "", 10) || 60;
  }
  return 0;
}

/**
 * Sends one error to Sentry. Never throws and never retries: a failed send is logged once as
 * `sentry_send_failed` and dropped, so a Sentry outage cannot slow or break a response.
 */
export async function captureException(error: unknown, options: CaptureOptions): Promise<void> {
  if (!options.dsn) return;
  const { requestId } = options;
  const target = parseDsn(options.dsn);
  if (target === null) {
    logLine("error", "sentry_send_failed", { requestId, status: null });
    return;
  }

  const now = Date.now();
  if (now < pausedUntil) return;
  const { type, value, stack } = describeThrown(error);
  const frames = framesOf(stack);
  const top = frames[0];
  const key =
    options.fingerprint?.join(":") ??
    [options.route, type, top ? `${top.function}@${top.filename}:${String(top.lineno)}` : ""].join(
      ":",
    );
  for (const [seen, at] of lastSent) if (now - at >= WINDOW_MS) lastSent.delete(seen);
  if (lastSent.has(key)) return;
  lastSent.set(key, now);

  const event = scrubEvent({
    event_id: crypto.randomUUID().replace(/-/g, ""),
    timestamp: now / 1000,
    platform: "javascript",
    level: options.level ?? "error",
    release: options.release,
    environment: options.env,
    tags: {
      request_id: requestId,
      route: options.route,
      env: options.env,
      release: options.release,
      side: options.side ?? "worker",
    },
    ...(options.fingerprint && { fingerprint: options.fingerprint }),
    exception: {
      values: [
        {
          type,
          value,
          // Sentry lists frames oldest first.
          stacktrace: { frames: [...frames].reverse() },
        },
      ],
    },
  });
  const envelope = [
    JSON.stringify({
      event_id: event.event_id,
      sent_at: new Date(now).toISOString(),
      dsn: options.dsn,
    }),
    JSON.stringify({ type: "event" }),
    JSON.stringify(event),
  ].join("\n");

  try {
    const response = await fetch(target.url, {
      method: "POST",
      headers: {
        "content-type": "application/x-sentry-envelope",
        "x-sentry-auth": `Sentry sentry_version=7, sentry_key=${target.key}, sentry_client=mop-envelope/1`,
      },
      body: envelope,
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    const pause = pauseSeconds(response);
    if (pause > 0) pausedUntil = Date.now() + pause * 1000;
    if (!response.ok)
      logLine("error", "sentry_send_failed", { requestId, status: response.status });
  } catch {
    logLine("error", "sentry_send_failed", { requestId, status: null });
  }
}
