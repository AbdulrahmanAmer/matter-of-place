import type { Db } from "./db.ts";
import { logLine, maskEmails } from "./log.ts";
import { routePath } from "./pipeline.ts";

// B14 GG-02, invariant 8: the unknown-path log. A 404 adds one `analytics_events` row to a per-isolate buffer, flushed
// as one `record_analytics_events` call at most every 10 seconds or at 20 rows. No IP, no user agent, no query string,
// the referrer reduced to its host, at most 1,000 rows a UTC day per isolate. A lost batch is acceptable: a failed
// flush drops its rows, logs once and never retries.

interface NotFoundContext {
  waitUntil: (promise: Promise<unknown>) => void;
}

// A type alias, not an interface: the row must be assignable to the generated `Json` argument.
type NotFoundRow = {
  event: "not_found";
  path: string;
  data: { referrer_host: string | null };
  occurred_at: string;
};

const DAILY_CAP = 1000;
const FLUSH_ROWS = 20;
const FLUSH_DELAY_MS = 10_000;

/**
 * Static assets, probe noise and the API, never logged, compared in the form the router matches (`routePath`). An API
 * path is never a redirect candidate, and a hook path can carry a secret: the ops-health token (DO-03).
 */
const NOT_FOUND_SKIP = {
  prefixes: ["/api/", "/assets/", "/wp-"],
  contains: [".php", "/.env", "/.git"],
  suffix: /\.(?:js|css|map|png|jpg|webp|avif|svg|ico|woff2)$/,
} as const;

let buffer: NotFoundRow[] = [];
let capDay = "";
let loggedToday = 0;

const skipped = (path: string): boolean =>
  NOT_FOUND_SKIP.prefixes.some((prefix) => path.startsWith(prefix)) ||
  NOT_FOUND_SKIP.contains.some((part) => path.includes(part)) ||
  NOT_FOUND_SKIP.suffix.test(path);

function referrerHost(request: Request): string | null {
  const referrer = request.headers.get("referer");
  if (referrer === null) return null;
  try {
    return new URL(referrer).host || null;
  } catch {
    // A referrer that is not a URL says nothing about where the visitor came from.
    return null;
  }
}

const delay = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** Swaps the buffer out before the insert, so a second flush never sends the same rows. */
async function flush(db: Db): Promise<void> {
  const rows = buffer;
  buffer = [];
  if (rows.length === 0) return;
  const failed = () => {
    logLine("warn", "not_found_flush_failed", { dropped: rows.length });
  };
  try {
    const { error } = await db.rpc("record_analytics_events", { p_rows: rows });
    if (error !== null) failed();
  } catch {
    failed();
  }
}

/** Called by the pipeline for a GET that answered 404; it never throws and never delays the response. */
export function logNotFound(db: Db, request: Request, ctx: NotFoundContext): void {
  const now = new Date();
  const { pathname } = new URL(request.url);
  if (skipped(routePath(pathname))) return;
  const today = now.toISOString().slice(0, 10);
  if (today !== capDay) {
    capDay = today;
    loggedToday = 0;
  }
  if (loggedToday >= DAILY_CAP) return;
  loggedToday += 1;
  buffer.push({
    event: "not_found",
    path: maskEmails(pathname),
    data: { referrer_host: referrerHost(request) },
    occurred_at: now.toISOString(),
  });
  if (buffer.length >= FLUSH_ROWS) ctx.waitUntil(flush(db));
  else if (buffer.length === 1) ctx.waitUntil(delay(FLUSH_DELAY_MS).then(() => flush(db)));
}
