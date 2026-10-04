import type { Json } from "../../db";
import type { AnalyticsBatch, CspReport } from "../../domain/contracts";
import { analyticsEvents } from "../../lib/analytics";
import type { Db } from "../lib/db";
import { sentryOptions } from "../lib/env";
import { logLine, maskEmails } from "../lib/log";
import { captureException } from "../lib/sentry";
import type { PublicCtx } from "../public/routes";

const DAY_MS = 86_400_000;
const known = new Set<string>(analyticsEvents);
const REPORT_WINDOW_MS = 60_000;
// A flood of distinct reports cannot grow the isolate without bound: past this many the rest are dropped.
const MAX_REMEMBERED_REPORTS = 1000;
// The directive and blocked address of each report stored in the last minute, by isolate (invariant 28).
const recentReports = new Map<string, number>();

/** Every string value with an address in it, masked: a beacon never stores one (R37). */
function scrub(value: Json): Json {
  if (typeof value === "string") return maskEmails(value);
  if (Array.isArray(value)) return value.map(scrub);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, inner]) =>
      inner === undefined ? [] : [[key, scrub(inner)]],
    ),
  );
}

/** The day `at` names, held within 24 hours of `now`; an unreadable one counts as now. */
function clamp(at: string, now: number): string {
  const stamp = Date.parse(at);
  const given = Number.isNaN(stamp) ? now : stamp;
  return new Date(Math.min(now + DAY_MS, Math.max(now - DAY_MS, given))).toISOString();
}

/**
 * `POST /events`: one beacon of at most 20 events becomes one `record_analytics_events` call. A name the allow-list
 * lacks is dropped, `at` is held within a day of now, `data` is stored as parsed (its `utm` included, G45). A lost
 * batch is acceptable, so a database error is logged and the answer is still 204.
 */
export async function record(db: Db, input: AnalyticsBatch, ctx: PublicCtx): Promise<undefined> {
  const now = Date.now();
  const rows = input
    .filter(({ event }) => known.has(event))
    .map(({ event, path, at, data }) => ({
      event,
      path: maskEmails(path),
      data: scrub(data),
      occurred_at: clamp(at, now),
    }));
  if (rows.length === 0) return undefined;
  const { error } = await db.rpc("record_analytics_events", { p_rows: rows });
  if (error !== null) logLine("warn", "analytics_store_failed", { requestId: ctx.requestId });
  return undefined;
}

/**
 * `POST /csp-report`: a report whose directive and blocked address were stored in the last 60 seconds is dropped,
 * and the rest become one `record_analytics_events` call. A browser never retries a report, so a lost one is
 * acceptable: a database error is logged and sent to Sentry, and the answer is still 204.
 */
export async function recordCspReports(
  db: Db,
  reports: readonly CspReport[],
  ctx: PublicCtx,
): Promise<undefined> {
  const now = Date.now();
  for (const [key, at] of recentReports)
    if (now - at >= REPORT_WINDOW_MS) recentReports.delete(key);
  const fresh = reports.filter(({ directive, blockedUri }) => {
    const key = `${directive}|${blockedUri}`;
    if (recentReports.has(key) || recentReports.size >= MAX_REMEMBERED_REPORTS) return false;
    recentReports.set(key, now);
    return true;
  });
  if (fresh.length === 0) return undefined;
  const occurredAt = new Date(now).toISOString();
  const { error } = await db.rpc("record_analytics_events", {
    p_rows: fresh.map(({ path, directive, blockedUri, disposition }) => ({
      event: "csp_report",
      path: maskEmails(path),
      data: { directive, blocked_uri: maskEmails(blockedUri), disposition },
      occurred_at: occurredAt,
    })),
  });
  if (error !== null) {
    logLine("warn", "analytics_store_failed", { requestId: ctx.requestId });
    ctx.wait(
      captureException(new Error(error.message), {
        requestId: ctx.requestId,
        route: "/api/public/csp-report",
        ...sentryOptions(),
      }),
    );
  }
  return undefined;
}
