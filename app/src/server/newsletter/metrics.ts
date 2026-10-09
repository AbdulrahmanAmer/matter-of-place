import { z } from "zod";
import type { Json } from "../../db/index.ts";
import type { Db } from "../lib/db.ts";
import { unsubscribedBetween } from "./audience.ts";

// What an issue did, from the `email_events` rows B5's webhook keeps (B11 Files). B8's reconcile job calls
// `aggregateRecentIssues` every 15 minutes: it reads only `email_events` and writes only `newsletter_issues.metrics`
// through `newsletter_set_metrics`, so it makes no Resend call and is cheap to repeat.

const RECENT_MS = 14 * 24 * 60 * 60 * 1000;

const COUNTED = {
  "email.delivered": "delivered",
  "email.bounced": "bounced",
  "email.complained": "complained",
  "email.opened": "opened",
  "email.clicked": "clicked",
} as const;

type Counted = (typeof COUNTED)[keyof typeof COUNTED];

const isCounted = (type: string): type is keyof typeof COUNTED => Object.hasOwn(COUNTED, type);

const clickData = z.object({ link: z.string() }).passthrough();

export interface IssueMetrics extends Record<Counted, number> {
  unsubscribed: number;
  per_property: Record<string, number>;
}

function rowsOf<T>(result: { data: T[] | null; error: unknown }, table: string): T[] {
  if (result.error !== null || result.data === null) {
    throw new Error(`newsletter_read_failed:${table}`);
  }
  return result.data;
}

/** The `utm_content` of a clicked link: the slug `withUtm` put there. */
function slugOf(data: Json): string | null {
  const link = clickData.safeParse(data).data?.link;
  if (link === undefined || !URL.canParse(link)) return null;
  return new URL(link).searchParams.get("utm_content");
}

/** The first `sent_at` after `sentAt`, the end of the window this issue's unsubscribes are counted in. */
async function nextSentAt(db: Db, sentAt: string): Promise<string | null> {
  const later = rowsOf(
    await db.from("newsletter_issues").select("sent_at").gt("sent_at", sentAt),
    "newsletter_issues",
  ).flatMap(({ sent_at }) => (sent_at === null ? [] : [sent_at]));
  return later.length === 0 ? null : later.reduce((a, b) => (a < b ? a : b));
}

/** Clicks per property slug; a slug that is not a property (a story) is left out. */
async function perProperty(db: Db, slugs: string[]): Promise<Record<string, number>> {
  if (slugs.length === 0) return {};
  const known = new Set(
    rowsOf(
      await db
        .from("properties")
        .select("slug")
        .in("slug", [...new Set(slugs)]),
      "properties",
    ).map(({ slug }) => slug),
  );
  const counts: Record<string, number> = {};
  for (const slug of slugs.filter((candidate) => known.has(candidate))) {
    counts[slug] = (counts[slug] ?? 0) + 1;
  }
  return counts;
}

/**
 * Counts the events of the issue's broadcast by type, each provider event once however often it was delivered,
 * clicks per property by the link's `utm_content`, and the subscribers who left between this issue and the next.
 * Null for an issue that has not been sent.
 */
export async function aggregateIssueMetrics(db: Db, issueId: string): Promise<IssueMetrics | null> {
  const [issue] = rowsOf(
    await db
      .from("newsletter_issues")
      .select("id, sent_at, resend_broadcast_id")
      .eq("id", issueId)
      .limit(1),
    "newsletter_issues",
  );
  if (issue?.sent_at == null || issue.resend_broadcast_id === null) return null;
  const events = rowsOf(
    await db
      .from("email_events")
      .select("provider_event_id, type, data")
      .eq("broadcast_id", issue.resend_broadcast_id),
    "email_events",
  );
  const metrics: IssueMetrics = {
    delivered: 0,
    bounced: 0,
    complained: 0,
    opened: 0,
    clicked: 0,
    unsubscribed: await unsubscribedBetween(db, issue.sent_at, await nextSentAt(db, issue.sent_at)),
    per_property: {},
  };
  const seen = new Set<string>();
  const clicked: string[] = [];
  for (const event of events) {
    if (seen.has(event.provider_event_id) || !isCounted(event.type)) continue;
    seen.add(event.provider_event_id);
    metrics[COUNTED[event.type]] += 1;
    const slug = event.type === "email.clicked" ? slugOf(event.data) : null;
    if (slug !== null) clicked.push(slug);
  }
  metrics.per_property = await perProperty(db, clicked);
  const { error } = await db.rpc("newsletter_set_metrics", {
    p_issue: issue.id,
    p_metrics: { ...metrics },
  });
  if (error !== null) throw new Error("newsletter_write_failed:newsletter_set_metrics");
  return metrics;
}

/** `aggregateIssueMetrics` for every issue sent in the last 14 days; answers how many it refreshed. */
export async function aggregateRecentIssues(db: Db, now: Date): Promise<{ issues: number }> {
  const since = new Date(now.getTime() - RECENT_MS).toISOString();
  const recent = rowsOf(
    await db.from("newsletter_issues").select("id").gt("sent_at", since),
    "newsletter_issues",
  );
  for (const { id } of recent) await aggregateIssueMetrics(db, id);
  return { issues: recent.length };
}
