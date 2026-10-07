import { z } from "zod";
import type { Json, Tables } from "../../db/index.ts";
import { channelSettingsSchema } from "../../domain/automation.ts";
import { socialChannelLabels, type SocialChannel } from "../../domain/channels.ts";
import { tiers } from "../../domain/events.ts";
import { formatInZone, toUtc } from "../../domain/market-time.ts";
import { stepSpecs } from "../automation/step-specs.ts";
import {
  NonRetryableError,
  type StepContext,
  type StepDefinition,
  type StepResult,
} from "../jobs/types.ts";
import type { Db } from "../lib/db.ts";
import { AppError } from "../lib/errors.ts";
import { enqueueJob } from "../lib/jobs.ts";
import { liveSideEffects, readVar } from "../lib/runtime-env.ts";
import { captureException } from "../lib/sentry.ts";
import { approvalStillValid } from "./approval.ts";
import { targetsFor } from "./index.ts";
import { GraphError } from "./meta.ts";
import { ChannelApiError } from "./oauth-tokens.ts";
import type { Channel, SocialAsset } from "./types.ts";
import { nextWindowSlot, planRetry } from "./window.ts";

// The one body of the three post steps (B10 invariants 2 to 8): every rule that decides whether a post goes out, the
// in-flight markers that make a crash safe (INT-01), and the alerts of a failure (invariant 3b, INT-04). Every row
// write goes through a social.sql function; the platform calls are the adapter's.

const RETRY_LATER_MS = 2 * 60_000;
const CONTAINER_LIMIT_MS = 60 * 60_000;
const STORY_METRICS_AFTER_MS = 20 * 60 * 60_000;
const MOVES_BEFORE_FAILURE = 3;
const POST_MAX_ATTEMPTS = stepSpecs.post_meta.maxAttempts ?? 1;
const INFLIGHT_AT = /^inflight:(.+?Z):/;

type Found =
  | { status: "posted"; remoteId: string; permalink: string }
  | { status: "in_progress"; containerId: string }
  | { status: "restart" }
  | { status: "not_found" }
  | { status: "skipped_budget" };

/** What `postToChannel` needs of an adapter: Meta's, X's and LinkedIn's each take a marker and look one up. */
interface PostingAdapter {
  id: SocialChannel;
  publish(
    asset: SocialAsset,
    ctx: StepContext,
    onMarker?: (marker: string) => Promise<void>,
  ): ReturnType<Channel["publish"]>;
  findRecentPost(marker: string, since: Date, ctx: StepContext): Promise<Found>;
}

interface PostParams {
  respectWindow: boolean;
  /** Retry on screen 12 with force: a deliberate repost of a revision (invariant 2). */
  force: boolean;
}

type Post = Tables<"social_posts">;
type ChannelRow = z.infer<typeof channelRowSchema>;

/** The post under way: its row, its asset and property, and its channel. */
interface Run {
  ctx: StepContext;
  post: Post;
  subject: Subject;
  channel: SocialChannel;
}

interface Subject {
  asset: Pick<
    Tables<"assets">,
    "id" | "kind" | "files" | "caption" | "meta" | "approved_by" | "property_id"
  >;
  property: Pick<Tables<"properties">, "slug" | "title" | "editorial_state" | "campaign_tier">;
}

const channelRowSchema = channelSettingsSchema
  .pick({ enabled: true, posting_window: true, approval_mode: true, auto_after: true })
  .extend({ channel: z.string() });
const multiImageSchema = z
  .object({ multi_image: z.boolean().nullable().optional() })
  .passthrough()
  .nullable();

/** Another run holds the row: its marker is already written (INT-01). */
class InFlightElsewhere extends Error {
  constructor() {
    super("in_flight_elsewhere");
    this.name = "InFlightElsewhere";
  }
}

const unavailable = (what: string) =>
  new AppError("unavailable", undefined, `The database did not answer (${what}).`);

const done = (result: Json): StepResult => ({ status: "done", result });
const later = (ctx: StepContext, reason: string): StepResult => ({
  status: "retry_at",
  at: new Date(ctx.now.getTime() + RETRY_LATER_MS),
  reason,
});

/**
 * Enqueues one `notify_admin` under `key` (the G13 contract of B5's resolver) and, when the job is new, reports the
 * alert to Sentry, which mails the owner while Resend cannot (INT-04). A second call for the same key does neither.
 */
export async function notifyAdmin(
  db: Db,
  key: string,
  headline: string,
  summary: string,
  linkPath: string,
): Promise<void> {
  const jobId = await enqueueJob(db, {
    type: "notify_admin",
    idempotencyKey: key,
    params: { headline },
    data: { summary, link_path: linkPath },
  });
  if (jobId === null) return;
  await captureException(new Error(headline), {
    fingerprint: ["alert", key.slice(0, key.indexOf(":"))],
    route: "job-runner",
    side: "job-runner",
    env: readVar("MOP_ENV") ?? "production",
    release: readVar("SENTRY_RELEASE") ?? "dev",
    dsn: readVar("SENTRY_DSN"),
    requestId: crypto.randomUUID(),
  });
}

async function loadSubject(ctx: StepContext, assetId: string): Promise<Subject> {
  const assets = await ctx.db
    .from("assets")
    .select("id, kind, files, caption, meta, approved_by, property_id")
    .eq("id", assetId)
    .limit(1);
  if (assets.error !== null) throw unavailable("assets");
  const asset = assets.data[0];
  if (asset === undefined) throw new NonRetryableError("asset_not_found");
  const properties = await ctx.db
    .from("properties")
    .select("slug, title, editorial_state, campaign_tier")
    .eq("id", asset.property_id)
    .limit(1);
  if (properties.error !== null) throw unavailable("properties");
  const property = properties.data[0];
  if (property === undefined) throw new NonRetryableError("property_not_found");
  return { asset, property };
}

async function loadChannelRows(ctx: StepContext): Promise<Map<string, ChannelRow>> {
  const { data, error } = await ctx.db
    .from("channel_settings")
    .select("channel, enabled, posting_window, approval_mode, auto_after");
  if (error !== null) throw unavailable("channel_settings");
  return new Map(
    data.map((row) => {
      const parsed = channelRowSchema.parse(row);
      return [parsed.channel, parsed];
    }),
  );
}

async function loadMultiImage(ctx: StepContext): Promise<boolean> {
  const { data, error } = await ctx.db.from("settings").select("value").eq("key", "linkedin");
  if (error !== null) throw unavailable("settings");
  return multiImageSchema.safeParse(data[0]?.value ?? null).data?.multi_image === true;
}

async function rpcOrThrow<T>(
  call: PromiseLike<{ data: T; error: unknown }>,
  what: string,
): Promise<T> {
  const { data, error } = await call;
  if (error !== null) throw unavailable(what);
  return data;
}

/** Invariant 4: a person's approval holds; any other holds only while this channel is `auto` for the tier. */
async function stillApproved(
  ctx: StepContext,
  subject: Subject,
  row: ChannelRow,
): Promise<boolean> {
  const { approved_by: approvedBy } = subject.asset;
  let approver: { actor_kind: "human" | "agent" } | null = null;
  if (approvedBy !== null) {
    const { data, error } = await ctx.db
      .from("user_roles")
      .select("actor_kind")
      .eq("user_id", approvedBy)
      .limit(1);
    if (error !== null) throw unavailable("user_roles");
    approver = data[0] ?? null;
  }
  const tier = tiers.find((name) => name === subject.property.campaign_tier);
  if (tier === undefined) return approvedBy !== null && approver?.actor_kind === "human";
  const today = ctx.now.toISOString().slice(0, 10);
  return approvalStillValid({ approved_by: approvedBy, tier }, approver, row, today);
}

/** Invariant 2: a re-render is a new asset row; once one revision of the kind is posted here, the next one is not. */
async function revisionPosted(
  ctx: StepContext,
  subject: Subject,
  channel: SocialChannel,
): Promise<boolean> {
  const others = await ctx.db
    .from("assets")
    .select("id")
    .eq("property_id", subject.asset.property_id)
    .eq("kind", subject.asset.kind)
    .neq("id", subject.asset.id);
  if (others.error !== null) throw unavailable("assets");
  if (others.data.length === 0) return false;
  const posted = await ctx.db
    .from("social_posts")
    .select("id")
    .in(
      "asset_id",
      others.data.map((other) => other.id),
    )
    .eq("channel", channel)
    .eq("status", "posted")
    .limit(1);
  if (posted.error !== null) throw unavailable("social_posts");
  return posted.data.length > 0;
}

/** The channel's posts of the local day in the window's zone, which the daily cap counts. */
async function postedToday(ctx: StepContext, channel: SocialChannel, tz: string): Promise<number> {
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(ctx.now);
  const { data, error } = await ctx.db
    .from("social_posts")
    .select("id")
    .eq("channel", channel)
    .eq("status", "posted")
    .gte("posted_at", toUtc(`${day}T00:00`, tz));
  if (error !== null) throw unavailable("social_posts");
  return data.length;
}

const label = (channel: SocialChannel) => socialChannelLabels[channel];

/** Fails a scheduled row; with `alert`, the failed-post notice of invariant 3b goes out once per post. */
async function fail(run: Run, error: string, alert: boolean): Promise<StepResult> {
  const { ctx, post, subject, channel } = run;
  await rpcOrThrow(ctx.db.rpc("fail_social_post", { p_id: post.id, p_error: error }), "fail");
  if (alert) {
    await notifyAdmin(
      ctx.db,
      `social_failed:${post.id}`,
      `${label(channel)} post failed`,
      `${subject.property.title}, ${subject.asset.kind}: ${error}`,
      `/admin/channels?post=${post.id}`,
    );
  }
  return done({ result: "failed", error });
}

async function markPosted(
  { ctx, post, subject }: Run,
  targets: string[],
  found: { remoteId: string; permalink: string },
): Promise<StepResult> {
  const postedAt = await rpcOrThrow(
    ctx.db.rpc("mark_social_post_posted", {
      p_id: post.id,
      p_remote_id: found.remoteId,
      p_permalink: found.permalink,
      p_targets: targets,
    }),
    "mark_social_post_posted",
  );
  // A story's metrics expire after a day: the reconcile job reads them 20 hours after the post (invariant 2).
  if (subject.asset.kind === "story" && postedAt !== null) {
    await enqueueJob(ctx.db, {
      type: "reconcile",
      idempotencyKey: `reconcile_story:${post.id}`,
      params: { post_ids: [post.id] },
      runAfter: new Date(Date.parse(postedAt) + STORY_METRICS_AFTER_MS),
    });
  }
  return done({ result: "posted", remote_id: found.remoteId, permalink: found.permalink });
}

/** The class and the words of a platform refusal; anything else is not the platform's and goes back to B8. */
function platformFailure(error: unknown): { class: string; message: string; code: string } | null {
  if (error instanceof GraphError) {
    return {
      class: error.detail.class,
      message: error.detail.message,
      code: String(error.detail.code ?? "unknown"),
    };
  }
  if (error instanceof ChannelApiError) {
    return {
      class: error.detail.class,
      message: error.detail.message,
      code: error.detail.reason ?? String(error.detail.status ?? "unknown"),
    };
  }
  return null;
}

/** Invariants 3a and 3b: retry inside the window, move to the next slot, or fail and alert. */
async function onFailure(
  run: Run,
  error: unknown,
  row: ChannelRow,
  today: number,
): Promise<StepResult> {
  const failure = platformFailure(error);
  if (failure === null) throw error;
  const { ctx, post, channel } = run;
  if (failure.class === "token_dead") {
    await rpcOrThrow(
      ctx.db.rpc("fail_social_post", { p_id: post.id, p_error: "token_dead" }),
      "fail",
    );
    await notifyAdmin(
      ctx.db,
      `token_dead:${channel}:${ctx.now.toISOString().slice(0, 10)}`,
      `${label(channel)} needs to be reconnected`,
      `The ${label(channel)} token was refused (${failure.code}). Run the authorize script again (docs/runbooks/social.md) or renew the Meta token (docs/runbooks/meta.md).`,
      "/admin/channels",
    );
    return done({ result: "failed", error: "token_dead" });
  }
  if (failure.class === "non_retryable") return fail(run, failure.message, true);
  const plan = planRetry(ctx.now, row.posting_window, today, ctx.job.attempts, POST_MAX_ATTEMPTS);
  if (!plan.moved) throw error;
  const moves = await ctx.db
    .from("audit_log")
    .select("id")
    .eq("action", "channels.reschedule")
    .eq("entity_id", post.id);
  if (moves.error !== null) throw unavailable("audit_log");
  if (moves.data.length >= MOVES_BEFORE_FAILURE) return fail(run, failure.message, true);
  const at = plan.at.toISOString();
  await rpcOrThrow(
    ctx.db.rpc("reschedule_social_post", {
      p_id: post.id,
      p_scheduled_at: at,
      p_note: `${label(channel)} answered with a temporary error, moved to ${formatInZone(at, row.posting_window.tz, "datetime")}`,
    }),
    "reschedule_social_post",
  );
  return { status: "retry_at", at: plan.at, reason: "window_moved" };
}

/**
 * A marker left by an earlier run (INT-01). A Meta container is polled again; an X or LinkedIn marker younger than
 * 2 minutes may belong to a run still between its create call and the mark, and an older one is looked up and adopted,
 * never posted again by itself. `restart` means the container failed and a new one may be made. A platform error of
 * the container's poll or publish is thrown, and the caller applies the failure rules of a publish to it.
 */
async function resolveMarker(
  ctx: StepContext,
  adapter: PostingAdapter,
  post: Post,
  marker: string,
): Promise<{ found: Found } | { result: StepResult }> {
  if (marker.startsWith("container:")) {
    return { found: await adapter.findRecentPost(marker, new Date(post.scheduled_at), ctx) };
  }
  const writtenAt = Date.parse(INFLIGHT_AT.exec(marker)?.[1] ?? "");
  if (!Number.isNaN(writtenAt) && ctx.now.getTime() - writtenAt < RETRY_LATER_MS) {
    return { result: later(ctx, "in_flight_elsewhere") };
  }
  try {
    return { found: await adapter.findRecentPost(marker, new Date(post.scheduled_at), ctx) };
  } catch (error) {
    if (platformFailure(error) === null) throw error;
    return { found: { status: "not_found" } };
  }
}

/**
 * Posts one approved asset to `adapter`'s channel, in the order of the plan's Files line: the kind's targets, the
 * channel switch, the row, the property, the approval, the revision, the window and cap, the dry run, an earlier
 * marker, then the post itself. Returns the step's answer; a platform error the window can still absorb is thrown.
 */
export async function postToChannel(
  ctx: StepContext,
  adapter: PostingAdapter,
  assetId: string,
  params: PostParams,
): Promise<StepResult> {
  const channel = adapter.id;
  const subject = await loadSubject(ctx, assetId);
  const targets = targetsFor(subject.asset.kind, {
    linkedin: { multi_image: await loadMultiImage(ctx) },
  });
  if (!targets.includes(channel)) return done("skipped_kind");
  const rows = await loadChannelRows(ctx);
  const row = rows.get(channel);
  if (row?.enabled !== true) return done("skipped_disabled");

  const post = await rpcOrThrow(
    ctx.db.rpc("schedule_social_post", {
      p_asset_id: assetId,
      p_channel: channel,
      p_scheduled_at: ctx.now.toISOString(),
    }),
    "schedule_social_post",
  );
  if (post === null) throw unavailable("schedule_social_post");
  if (post.status === "posted") return done({ result: "posted", remote_id: post.remote_id });
  const run: Run = { ctx, post, subject, channel };
  if (post.status === "failed") {
    return done(
      post.error === "cancelled"
        ? { skipped: "cancelled" }
        : { result: "failed", error: post.error },
    );
  }
  if (subject.property.editorial_state !== "published") {
    return fail(run, "property_unpublished", false);
  }
  if (!(await stillApproved(ctx, subject, row))) {
    return fail(run, "human_approval_required", false);
  }
  if (!params.force && (await revisionPosted(ctx, subject, channel))) {
    return fail(run, "revision_already_posted", false);
  }

  const window = row.posting_window;
  const today = await postedToday(ctx, channel, window.tz);
  const capped = today >= window.daily_cap;
  const slot = params.respectWindow || capped ? nextWindowSlot(ctx.now, window, today) : ctx.now;
  if (slot > ctx.now) return { status: "retry_at", at: slot, reason: "outside_window" };

  const asset: SocialAsset = { ...subject.asset, property_slug: subject.property.slug };
  if (!liveSideEffects("social")) {
    ctx.log("info", "social_dry_run", { channel, assetId, kind: asset.kind, postId: post.id });
    return done({ result: "dry_run" });
  }

  const liveTargets = targets.filter((target) => rows.get(target)?.enabled === true);
  if (
    post.error?.startsWith("inflight:") === true ||
    post.error?.startsWith("container:") === true
  ) {
    let resolved: Awaited<ReturnType<typeof resolveMarker>>;
    try {
      resolved = await resolveMarker(ctx, adapter, post, post.error);
    } catch (error) {
      return onFailure(run, error, row, today);
    }
    if ("result" in resolved) return resolved.result;
    const { found } = resolved;
    if (found.status === "posted") return markPosted(run, liveTargets, found);
    if (found.status === "in_progress") {
      if (ctx.now.getTime() - Date.parse(post.scheduled_at) >= CONTAINER_LIMIT_MS) {
        return fail(run, "container_timeout", true);
      }
      return later(ctx, "container_in_progress");
    }
    if (found.status !== "restart") return fail(run, "outcome_unknown", true);
    await rpcOrThrow(ctx.db.rpc("set_social_post_inflight", { p_id: post.id }), "clear marker");
  }

  const onMarker = async (marker: string) => {
    const held = await rpcOrThrow(
      ctx.db.rpc("set_social_post_inflight", { p_id: post.id, p_marker: marker }),
      "set_social_post_inflight",
    );
    if (!held) throw new InFlightElsewhere();
  };
  let published: Awaited<ReturnType<PostingAdapter["publish"]>>;
  try {
    published = await adapter.publish(asset, ctx, onMarker);
  } catch (error) {
    if (error instanceof InFlightElsewhere) return later(ctx, "in_flight_elsewhere");
    return onFailure(run, error, row, today);
  }
  if (published.status === "in_progress") return later(ctx, "container_in_progress");
  if (published.status === "skipped_disabled") return done("skipped_disabled");
  return markPosted(run, liveTargets, published);
}

const postDataSchema = z
  .object({ asset_id: z.string().uuid(), force: z.boolean().optional() })
  .passthrough();
const respectWindowSchema = z.object({ respect_window: z.boolean() }).passthrough();

/** One answer for the job: a channel that waits makes the job wait for the earliest of them, else it is done. */
function jobResult(results: [SocialChannel, StepResult][]): StepResult {
  const [only] = results;
  if (results.length === 1 && only !== undefined) return only[1];
  const result = Object.fromEntries(
    results.map(([channel, answer]) => [channel, answer.result ?? answer.status]),
  );
  const waits = results.flatMap(([, answer]) => (answer.status === "retry_at" ? [answer] : []));
  const first = waits.sort((a, b) => a.at.getTime() - b.at.getTime())[0];
  return first === undefined ? done(result) : { ...first, result };
}

/**
 * The step definition of `post_meta`, `post_x` or `post_linkedin`: its spec from B8b's catalog (attempts and the
 * 40-second limit, JOB-02) and the job's asset posted to each adapter in turn. A step that fails its row ends `done`
 * with `{ result: "failed", error }`: the failure lives in `social_posts`, not in the dead-letter list.
 */
export function postStep(
  type: "post_meta" | "post_x" | "post_linkedin",
  adaptersFor: (params: unknown) => PostingAdapter[],
): StepDefinition {
  const spec = stepSpecs[type];
  return {
    type,
    heavy: spec.heavy,
    paramsSchema: spec.paramsSchema,
    ...(spec.maxAttempts === undefined ? {} : { maxAttempts: spec.maxAttempts }),
    ...(spec.timeoutMs === undefined ? {} : { timeoutMs: spec.timeoutMs }),
    async run(ctx, params, data) {
      const { asset_id: assetId, force } = postDataSchema.parse(data);
      const postParams = {
        respectWindow: respectWindowSchema.parse(params).respect_window,
        force: force === true,
      };
      const results: [SocialChannel, StepResult][] = [];
      for (const adapter of adaptersFor(params)) {
        results.push([adapter.id, await postToChannel(ctx, adapter, assetId, postParams)]);
      }
      return jobResult(results);
    },
  };
}
