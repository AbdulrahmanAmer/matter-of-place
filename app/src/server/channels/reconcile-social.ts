import { z } from "zod";
import type { Json, Tables } from "../../db/index.ts";
import { socialChannelLabels, type SocialChannel } from "../../domain/channels.ts";
import { NonRetryableError, type StepContext } from "../jobs/types.ts";
import type { Db } from "../lib/db.ts";
import { AppError } from "../lib/errors.ts";
import { enqueueJob } from "../lib/jobs.ts";
import { addDays, buildCampaignReport, weekStartOf } from "../reports/build.ts";
import { getChannel, targetsFor } from "./index.ts";
import { createLinkedInChannel } from "./linkedin.ts";
import { createMetaChannel, GraphError } from "./meta.ts";
import { tokenHealth } from "./meta-token.ts";
import { ChannelApiError, checkChannelToken } from "./oauth-tokens.ts";
import { notifyAdmin } from "./post-to-channel.ts";
import type { Channel } from "./types.ts";
import { createXChannel } from "./x.ts";

// The social part of B8's `reconcile` job (B10 Files, G10, G60). B8b's `reconcile` schedule row runs the job every
// 15 minutes; the first tick at or after 05:00 UTC enqueues one daily run under a key that holds the date, which is the
// only clock this part has. The daily run is safe to repeat: metrics and reports are upserts, and the overdue and
// in-flight rules change a row only while it is still `scheduled`.

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const OVERDUE_MS = 48 * HOUR_MS;
const MARKER_MS = HOUR_MS;
const DAILY_FROM_UTC_HOUR = 5;
const METRIC_DAYS = [1, 3, 7, 14, 28];
const DEFAULT_X_METRICS_DAYS = [7, 28];
const REPORT_GRACE_DAYS = 35;
const NO_WINDOW_DAYS = 29;
const MESSAGE_LENGTH = 160;
const METRICS_WINDOW_MS = (Math.max(...METRIC_DAYS) + 1) * DAY_MS;

type Post = Tables<"social_posts">;

const paramsSchema = z
  .object({ post_ids: z.array(z.string().uuid()).optional(), daily: z.boolean().optional() })
  .passthrough();

const settingsSchema = z
  .object({
    user_id: z.string().optional(),
    organization_urn: z.string().optional(),
    metrics_days: z.array(z.number()).optional(),
    multi_image: z.boolean().nullable().optional(),
  })
  .passthrough();

const unavailable = (what: string) =>
  new AppError("unavailable", undefined, `The database did not answer (${what}).`);

/** The rows of a read; a failed read, which leaves no data, is a database error and throws. */
async function read<T>(
  call: PromiseLike<{ data: T | null; error: unknown }>,
  what: string,
): Promise<T> {
  const { data, error } = await call;
  if (error !== null || data === null) throw unavailable(what);
  return data;
}

/** The answer of a write; a database error throws, so B8's backoff retries the whole job. */
async function write<T>(call: PromiseLike<{ data: T; error: unknown }>, what: string): Promise<T> {
  const { data, error } = await call;
  if (error !== null) throw unavailable(what);
  return data;
}

const isSocialChannel = (value: string): value is SocialChannel =>
  Object.hasOwn(socialChannelLabels, value);

/**
 * What an adapter throws for a platform that refused: the platform's own error classes. An `unavailable` AppError is
 * the database or an outage (the adapters raise both the same way) and throws, so B8's backoff retries the job; any
 * other AppError is a setting or a token of that channel and is counted.
 */
const isPlatformError = (error: unknown): error is Error =>
  error instanceof GraphError ||
  error instanceof ChannelApiError ||
  (error instanceof AppError && error.code !== "unavailable");

const describeError = (id: string, error: Error) =>
  `${id}: ${error.message}`.slice(0, MESSAGE_LENGTH);

type Found =
  | { status: "posted"; remoteId: string; permalink: string }
  | { status: "in_progress" }
  | { status: "restart" }
  | { status: "not_found" }
  | { status: "skipped_budget" };

interface Lookup {
  findRecentPost(marker: string, since: Date, ctx: StepContext): Promise<Found>;
}

/** The adapter that can look a marker up; YouTube has none, and a row of it never holds a marker. */
function lookupFor(channel: string): Lookup | null {
  switch (channel) {
    case "instagram":
    case "facebook":
      return createMetaChannel(channel);
    case "x":
      return createXChannel();
    case "linkedin":
      return createLinkedInChannel();
    default:
      return null;
  }
}

/** The channel rows and the three `settings` rows, read once per run. */
interface World {
  enabled: Map<string, boolean>;
  settings: Map<string, unknown>;
}

async function loadWorld(db: Db): Promise<World> {
  const [rows, settings] = await Promise.all([
    read(db.from("channel_settings").select("channel, enabled"), "channel_settings"),
    read(db.from("settings").select("key, value").in("key", ["meta", "x", "linkedin"]), "settings"),
  ]);
  return {
    enabled: new Map(rows.map((row) => [row.channel, row.enabled])),
    settings: new Map(settings.map((row) => [row.key, row.value])),
  };
}

const settingsOf = (world: World, key: string) =>
  settingsSchema.safeParse(world.settings.get(key)).data ?? {};

async function reconcileEnabled(db: Db): Promise<boolean> {
  const rows = await read(
    db.from("schedule_settings").select("enabled").eq("key", "reconcile"),
    "schedule_settings",
  );
  return rows[0]?.enabled !== false;
}

type MetricsAnswer = Awaited<ReturnType<Channel["metrics"]>>;

/** Asks the platform for one posted row's metrics; null when the row has nothing to ask about. */
async function askMetrics(
  ctx: StepContext,
  world: World,
  post: Post,
): Promise<MetricsAnswer | null> {
  if (post.remote_id === null || !isSocialChannel(post.channel)) return null;
  const channel = getChannel(post.channel, world.enabled.get(post.channel) === true);
  return await channel.metrics({ remoteId: post.remote_id, permalink: post.permalink }, ctx);
}

interface Tally {
  fetched: number;
  skipped_budget: number;
  errors: string[];
}

/** Fetches and stores the metrics of each post. A platform error is counted and the run goes on; ours throws. */
async function refreshPosts(ctx: StepContext, world: World, posts: Post[]): Promise<Tally> {
  const tally: Tally = { fetched: 0, skipped_budget: 0, errors: [] };
  for (const post of posts) {
    let answer: MetricsAnswer | null;
    try {
      answer = await askMetrics(ctx, world, post);
    } catch (error) {
      if (!isPlatformError(error)) throw error;
      tally.errors.push(describeError(post.id, error));
      continue;
    }
    if (answer?.status === "skipped_budget") tally.skipped_budget += 1;
    if (answer?.status !== "fetched") continue;
    await write(
      ctx.db.rpc("set_social_post_metrics", { p_id: post.id, p_metrics: answer.metrics }),
      "set_social_post_metrics",
    );
    tally.fetched += 1;
  }
  return tally;
}

/** (a) The posts a person or a story's own job named: their metrics and nothing else. */
async function refreshNamed(ctx: StepContext, ids: string[]): Promise<Json> {
  const [world, posts] = await Promise.all([
    loadWorld(ctx.db),
    read(
      ctx.db.from("social_posts").select("*").in("id", ids).eq("status", "posted"),
      "social_posts",
    ),
  ]);
  const { fetched, ...rest } = await refreshPosts(ctx, world, posts);
  return { metrics: fetched, ...rest };
}

const isMarker = (post: Post) =>
  post.error?.startsWith("inflight:") === true || post.error?.startsWith("container:") === true;

/** The channels a posted row counts toward: the kind's targets that are switched on (as `postToChannel` reads them). */
async function liveTargets(db: Db, world: World, assetId: string): Promise<string[]> {
  const assets = await read(db.from("assets").select("kind").eq("id", assetId), "assets");
  const kind = assets[0]?.kind;
  if (kind === undefined) return [];
  const multiImage = settingsOf(world, "linkedin").multi_image === true;
  return targetsFor(kind, { linkedin: { multi_image: multiImage } }).filter(
    (target) => world.enabled.get(target) === true,
  );
}

async function failAndAlert(ctx: StepContext, post: Post, error: string): Promise<void> {
  await write(ctx.db.rpc("fail_social_post", { p_id: post.id, p_error: error }), "fail");
  await notifyAdmin(
    ctx.db,
    `social_failed:${post.id}`,
    `${isSocialChannel(post.channel) ? socialChannelLabels[post.channel] : post.channel} post failed`,
    `Post ${post.id}: ${error}`,
    `/admin/channels?post=${post.id}`,
  );
}

interface Markers {
  posted: number;
  failed: number;
  left: number;
}

/**
 * A marker older than an hour is taken to belong to a run that is gone (INT-01). The platform is asked once: a post found is
 * recorded, a container still processing is `container_timeout`, and a marker the platform cannot place is
 * `outcome_unknown` (so is an X marker while the read allowance is spent, invariant 11); nothing is created again. A
 * container Meta wants restarted is left for the post step's own retry.
 */
async function resolveMarkers(
  ctx: StepContext,
  world: World,
  scheduled: Post[],
  errors: string[],
): Promise<Markers> {
  const tally: Markers = { posted: 0, failed: 0, left: 0 };
  const stale = scheduled.filter(
    (post) => isMarker(post) && Date.parse(post.updated_at) < ctx.now.getTime() - MARKER_MS,
  );
  for (const post of stale) {
    const lookup = lookupFor(post.channel);
    if (lookup === null || post.error === null) continue;
    let found: Found;
    try {
      found = await lookup.findRecentPost(post.error, new Date(post.scheduled_at), ctx);
    } catch (error) {
      if (!isPlatformError(error)) throw error;
      errors.push(describeError(post.id, error));
      tally.left += 1;
      continue;
    }
    if (found.status === "posted") {
      await write(
        ctx.db.rpc("mark_social_post_posted", {
          p_id: post.id,
          p_remote_id: found.remoteId,
          p_permalink: found.permalink,
          p_targets: await liveTargets(ctx.db, world, post.asset_id),
        }),
        "mark_social_post_posted",
      );
      tally.posted += 1;
    } else if (found.status === "restart") {
      tally.left += 1;
    } else {
      await failAndAlert(
        ctx,
        post,
        found.status === "in_progress" ? "container_timeout" : "outcome_unknown",
      );
      tally.failed += 1;
    }
  }
  return tally;
}

/** Fails each row that never went out and holds no marker; a row with a marker waits for its lookup. */
async function failOverdue(ctx: StepContext, scheduled: Post[]): Promise<number> {
  const overdue = scheduled.filter(
    (post) => !isMarker(post) && Date.parse(post.scheduled_at) < ctx.now.getTime() - OVERDUE_MS,
  );
  for (const post of overdue) {
    await write(
      ctx.db.rpc("fail_social_post", { p_id: post.id, p_error: "overdue" }),
      "fail_social_post",
    );
  }
  return overdue.length;
}

type TokenReport = Record<"meta" | "x" | "linkedin", string>;

/** The daily token check of X and LinkedIn (a channel with no account ids is not asked) and Meta's stored health. */
async function checkTokens(ctx: StepContext, world: World, errors: string[]): Promise<TokenReport> {
  const report: TokenReport = {
    meta: tokenHealth(world.settings.get("meta") ?? null, ctx.now).level,
    x: "not_configured",
    linkedin: "not_configured",
  };
  const configured = {
    x: (settingsOf(world, "x").user_id ?? "") !== "",
    linkedin: (settingsOf(world, "linkedin").organization_urn ?? "") !== "",
  };
  for (const channel of ["x", "linkedin"] as const) {
    if (!configured[channel]) continue;
    try {
      report[channel] = await checkChannelToken(ctx, channel);
    } catch (error) {
      if (!isPlatformError(error)) throw error;
      errors.push(describeError(channel, error));
      report[channel] = "error";
    }
  }
  return report;
}

/** The posts whose age in whole days is a metrics day of their channel (X: the days of `settings.x.metrics_days`). */
function dueForMetrics(posts: Post[], world: World, now: Date): Post[] {
  const xDays = settingsOf(world, "x").metrics_days ?? DEFAULT_X_METRICS_DAYS;
  return posts.filter((post) => {
    if (post.posted_at === null) return false;
    const age = Math.floor((now.getTime() - Date.parse(post.posted_at)) / DAY_MS);
    return (post.channel === "x" ? xDays : METRIC_DAYS).includes(age);
  });
}

/**
 * A report for every ISO week of every campaign that has started and ended no more than 35 days ago. A campaign's
 * start is its `starts_on`, else the day of its first posted row; its end is its `ends_on`, else 29 days after the
 * start (the 30-day rule of a product with no window, DL-09). One with no start yet is skipped.
 */
async function buildReports(ctx: StepContext): Promise<{ built: number; not_started: number }> {
  const today = ctx.now.toISOString().slice(0, 10);
  const oldest = addDays(today, -REPORT_GRACE_DAYS);
  const campaigns = await read(
    ctx.db.from("campaigns").select("id, property_id, starts_on, ends_on"),
    "campaigns",
  );
  const tally = { built: 0, not_started: 0 };
  for (const campaign of campaigns) {
    let start = campaign.starts_on;
    if (start === null) {
      const first = await read(
        ctx.db
          .from("social_posts")
          .select("posted_at")
          .eq("property_id", campaign.property_id)
          .eq("status", "posted")
          .order("posted_at", { ascending: true })
          .limit(1),
        "social_posts",
      );
      start = first[0]?.posted_at?.slice(0, 10) ?? null;
    }
    if (start === null || start > today) {
      tally.not_started += 1;
      continue;
    }
    const end = campaign.ends_on ?? addDays(start, NO_WINDOW_DAYS);
    if (end < oldest) continue;
    const last = end < today ? end : today;
    for (let week = weekStartOf(start); week <= last; week = addDays(week, 7)) {
      const built = await buildCampaignReport(ctx.db, campaign.id, week);
      if ("status" in built) tally.built += 1;
    }
  }
  return tally;
}

/** (b) The daily part, once per UTC day (invariant 11 holds inside the metrics step: the X adapter refuses at 90 percent). */
async function daily(ctx: StepContext): Promise<Json> {
  if (!(await reconcileEnabled(ctx.db))) return "skipped_disabled";
  const errors: string[] = [];
  const world = await loadWorld(ctx.db);
  const scheduled = await read(
    ctx.db.from("social_posts").select("*").eq("status", "scheduled"),
    "social_posts",
  );
  const markers = await resolveMarkers(ctx, world, scheduled, errors);
  const overdue = await failOverdue(ctx, scheduled);
  const tokens = await checkTokens(ctx, world, errors);
  const posted = await read(
    ctx.db
      .from("social_posts")
      .select("*")
      .eq("status", "posted")
      .gte("posted_at", new Date(ctx.now.getTime() - METRICS_WINDOW_MS).toISOString()),
    "social_posts",
  );
  const metrics = await refreshPosts(ctx, world, dueForMetrics(posted, world, ctx.now));
  errors.push(...metrics.errors);
  const completed = await write(
    ctx.db.rpc("complete_distributed_submissions", { p_now: ctx.now.toISOString() }),
    "complete_distributed_submissions",
  );
  const reports = await buildReports(ctx);
  return {
    overdue,
    markers: { ...markers },
    tokens,
    metrics: metrics.fetched,
    skipped_budget: metrics.skipped_budget,
    completed,
    reports,
    errors,
  };
}

/**
 * (c) A quarter-hour run: the first one at or after 05:00 UTC enqueues the day's daily run. Its key holds the date, so
 * the other ticks of the day find it and do nothing; no run before 05:00 UTC enqueues anything.
 */
async function tick(ctx: StepContext, now: Date): Promise<Json> {
  if (now.getUTCHours() < DAILY_FROM_UTC_HOUR) return "not_due";
  const id = await enqueueJob(ctx.db, {
    type: "reconcile",
    idempotencyKey: `reconcile_social:${now.toISOString().slice(0, 10)}`,
    params: { daily: true },
  });
  return id === null ? "daily_exists" : "daily_enqueued";
}

/** `reconcileSocial(ctx, params, now)`: the value stored under `result.social` of the reconcile job. */
export async function reconcileSocial(
  ctx: StepContext,
  params: Json,
  now: Date,
): Promise<{ social: Json }> {
  const parsed = paramsSchema.safeParse(params);
  if (!parsed.success) throw new NonRetryableError("invalid_params");
  const { post_ids: ids, daily: isDaily } = parsed.data;
  if (ids !== undefined) return { social: await refreshNamed(ctx, ids) };
  return { social: isDaily === true ? await daily(ctx) : await tick(ctx, now) };
}
