import { z } from "zod";
import type { Json } from "../../db/index.ts";
import { socialChannelLabels } from "../../domain/channels.ts";
import type { Db } from "../lib/db.ts";
import { AppError } from "../lib/errors.ts";

// The weekly report of one campaign (B10 Files, `build.ts`, G7, G22). It is loaded by the Deno job runner through the
// reconcile job, so it reads the database only and calls no platform (invariant 1): the numbers are what the daily part
// of `reconcile-social.ts` stored on each post, and the clicks are first-party visits counted by `track()`.

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_X_METRICS_DAYS = [7, 28];

const unavailable = (what: string) =>
  new AppError("unavailable", undefined, `The database did not answer (${what}).`);

/** `days` after the date `iso` (`YYYY-MM-DD`), as a date. */
export function addDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** The Monday of the ISO week that holds the date `iso`. */
export function weekStartOf(iso: string): string {
  const weekday = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return addDays(iso, -((weekday + 6) % 7));
}

const metricsSchema = z
  .object({
    reach: z.number().nullish(),
    views: z.number().nullish(),
    clicks: z.number().nullish(),
  })
  .passthrough();

const numeric = (value: number | null | undefined): number | null => value ?? null;
const sum = (values: (number | null)[]): number | null => {
  const given = values.filter((value) => value !== null);
  return given.length === 0 ? null : given.reduce((a, b) => a + b, 0);
};

interface Counted {
  posts: number;
  reach: number | null;
  views: number | null;
  clicks: number;
  platform_clicks: number | null;
}

/** An entry of `channel_mix`: a field the channel did not return is left out, never written as 0. */
function mixEntry(counted: Counted, measured: boolean): Record<string, number> {
  const entry: Record<string, number> = { posts: counted.posts, clicks: counted.clicks };
  if (measured) {
    if (counted.reach !== null) entry["reach"] = counted.reach;
    if (counted.views !== null) entry["views"] = counted.views;
    if (counted.platform_clicks !== null) entry["platform_clicks"] = counted.platform_clicks;
  }
  return entry;
}

const utmSchema = z
  .object({ utm: z.object({ utm_source: z.string().optional() }).passthrough().optional() })
  .passthrough();

const perPropertySchema = z
  .object({
    per_property: z
      .record(z.string(), z.object({ clicks: z.number().optional() }).passthrough())
      .optional(),
  })
  .passthrough();

const xSettingsSchema = z.object({ metrics_days: z.array(z.number()).optional() }).passthrough();

export type BuildResult = { status: "built"; id: string } | { skipped: "no_campaign" };

/**
 * Builds the report of one ISO week (`weekStart` is its Monday, `YYYY-MM-DD`) of one campaign and stores it through
 * `upsert_campaign_report`, so a rerun replaces the week's row. A post counts in the week it was posted, with its
 * latest metrics, when that day also lies inside the campaign's dates (a null bound is open, the B6 default; weeks
 * and days are UTC). A campaign that does not exist produces no report.
 */
export async function buildCampaignReport(
  db: Db,
  campaignId: string,
  weekStart: string,
): Promise<BuildResult> {
  const weekEnd = addDays(weekStart, 7);
  const campaigns = await db
    .from("campaigns")
    .select("property_id, starts_on, ends_on")
    .eq("id", campaignId);
  if (campaigns.error !== null) throw unavailable("campaigns");
  const campaign = campaigns.data[0];
  if (campaign === undefined) return { skipped: "no_campaign" };
  const [properties, posts, settings, issues] = await Promise.all([
    db.from("properties").select("slug").eq("id", campaign.property_id),
    db
      .from("social_posts")
      .select("asset_id, channel, metrics, posted_at")
      .eq("property_id", campaign.property_id)
      .eq("status", "posted")
      .order("posted_at", { ascending: true }),
    db.from("settings").select("value").eq("key", "x"),
    db
      .from("newsletter_issues")
      .select("metrics, sent_at")
      .not("sent_at", "is", null)
      .gte("sent_at", `${weekStart}T00:00:00Z`)
      .lt("sent_at", `${weekEnd}T00:00:00Z`),
  ]);
  if (properties.error !== null) throw unavailable("properties");
  if (posts.error !== null) throw unavailable("social_posts");
  if (settings.error !== null) throw unavailable("settings");
  if (issues.error !== null) throw unavailable("newsletter_issues");
  const slug = properties.data[0]?.slug;
  if (slug === undefined) return { skipped: "no_campaign" };

  const inside = posts.data.filter((post) => {
    const day = (post.posted_at ?? "").slice(0, 10);
    return (
      day >= weekStart &&
      day < weekEnd &&
      (campaign.starts_on === null || day >= campaign.starts_on) &&
      (campaign.ends_on === null || day <= campaign.ends_on)
    );
  });
  const kinds = await db
    .from("assets")
    .select("id, kind")
    .in(
      "id",
      inside.map((post) => post.asset_id),
    );
  if (kinds.error !== null) throw unavailable("assets");
  const reels = new Set(
    kinds.data.filter((asset) => asset.kind === "reel").map((asset) => asset.id),
  );

  const visits = await db
    .from("analytics_events")
    .select("data")
    .eq("event", "property_view")
    .eq("data->utm->>utm_medium", "social")
    .eq("data->utm->>utm_campaign", slug)
    .gte("occurred_at", `${weekStart}T00:00:00Z`)
    .lt("occurred_at", `${weekEnd}T00:00:00Z`);
  if (visits.error !== null) throw unavailable("analytics_events");

  const mix = new Map<string, Counted>();
  const entryOf = (channel: string): Counted => {
    const held = mix.get(channel);
    if (held !== undefined) return held;
    const created: Counted = {
      posts: 0,
      reach: null,
      views: null,
      clicks: 0,
      platform_clicks: null,
    };
    mix.set(channel, created);
    return created;
  };
  let impressions: number | null = null;
  let reach: number | null = null;
  const reelViews: (number | null)[] = [];
  let best: { asset: string; reach: number } | null = null;
  for (const post of inside) {
    const metrics = metricsSchema.safeParse(post.metrics).data;
    const own = { reach: numeric(metrics?.reach), views: numeric(metrics?.views) };
    const counted = entryOf(post.channel);
    counted.posts += 1;
    counted.reach = sum([counted.reach, own.reach]);
    counted.views = sum([counted.views, own.views]);
    counted.platform_clicks = sum([counted.platform_clicks, numeric(metrics?.clicks)]);
    reach = sum([reach, own.reach]);
    impressions = sum([impressions, own.views]);
    if (reels.has(post.asset_id)) reelViews.push(own.views);
    if (own.reach !== null && (best === null || own.reach > best.reach)) {
      best = { asset: post.asset_id, reach: own.reach };
    }
  }
  let clicks = 0;
  for (const visit of visits.data) {
    const source = utmSchema.safeParse(visit.data).data?.utm?.utm_source;
    if (source === undefined || !Object.hasOwn(socialChannelLabels, source)) continue;
    entryOf(source).clicks += 1;
    clicks += 1;
  }
  const measuredX =
    (
      xSettingsSchema.safeParse(settings.data[0]?.value).data?.metrics_days ??
      DEFAULT_X_METRICS_DAYS
    ).length > 0;
  const channelMix = Object.fromEntries(
    [...mix].map(([channel, counted]) => [
      channel,
      mixEntry(counted, channel !== "x" || measuredX),
    ]),
  );

  const owned = issues.data.flatMap((issue) => {
    const own = perPropertySchema.safeParse(issue.metrics).data?.per_property?.[
      campaign.property_id
    ];
    return own === undefined ? [] : [own.clicks ?? 0];
  });
  const total = impressions ?? 0;
  const row: Json = {
    media_spend: 0,
    impressions: total,
    reach: reach ?? 0,
    clicks,
    video_views: sum(reelViews),
    ctr: total === 0 ? null : clicks / total,
    geography: {},
    channel_mix: channelMix,
    owned_distribution: {
      newsletter_issues: owned.length,
      newsletter_clicks: owned.reduce((a, b) => a + b, 0),
    },
    top_creative: best?.asset ?? null,
  };
  const stored = await db.rpc("upsert_campaign_report", {
    p_campaign_id: campaignId,
    p_period_start: weekStart,
    p_row: row,
  });
  if (stored.error !== null) throw unavailable("upsert_campaign_report");
  return { status: "built", id: stored.data };
}
