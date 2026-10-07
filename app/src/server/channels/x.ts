import { z } from "zod";
import type { StepContext } from "../jobs/types.ts";
import { AppError } from "../lib/errors.ts";
import { captionFor, filesFor, targetsFor } from "./index.ts";
import {
  callApi,
  mediaBytes,
  readChannelSettings,
  tokenState,
  type TokenContext,
} from "./oauth-tokens.ts";
import type { Channel, SocialAsset } from "./types.ts";

// The X adapter (B10 step 5a, R32): a cover is posted as its `role: x` file with the short caption. The bytes come
// from the file's public address, then the media upload, then the post. Every read is counted in `settings.x.usage`
// by `callApi`, and a metrics read stops at 90 percent of `settings.x.read_allowance` so the last 10 percent stays
// for the in-flight lookup (invariant 11, INT-08). Step 3a confirms the calls against the live API.

const API = "https://api.x.com/2";
const INFLIGHT = /^inflight:.+:media:(\d+)$/;
const METRICS_SHARE = 0.9;

type Posted = { status: "posted"; remoteId: string; permalink: string };

/**
 * `publish` awaits `onMarker` with `inflight:<UTC timestamp>:media:<media_id>` once the media is uploaded and before
 * the post is created, so the caller stores the handle first (R28). `findRecentPost` reads the account's posts since
 * `since` and adopts only the one whose media keys hold `3_<media_id>`; it never compares text (INT-01).
 */
export interface XChannel extends Channel {
  publish(
    asset: SocialAsset,
    ctx: StepContext,
    onMarker?: (marker: string) => Promise<void>,
  ): ReturnType<Channel["publish"]>;
  findRecentPost(
    marker: string,
    since: Date,
    ctx: StepContext,
  ): Promise<Posted | { status: "not_found" } | { status: "skipped_budget" }>;
}

const idField = z.string().min(1);
const settingsSchema = z
  .object({
    user_id: idField,
    handle: idField,
    read_allowance: z.number().nullable().optional(),
    usage: z.object({ month: z.string(), reads: z.number() }).passthrough().optional(),
  })
  .passthrough();
type XSettings = z.infer<typeof settingsSchema>;

const uploadSchema = z.object({ data: z.object({ id: idField }).passthrough() }).passthrough();
const createSchema = z.object({ data: z.object({ id: idField }).passthrough() }).passthrough();
const count = z.number().optional();
const metricsSchema = z
  .object({
    data: z
      .object({
        public_metrics: z
          .object({
            impression_count: count,
            like_count: count,
            retweet_count: count,
            reply_count: count,
          })
          .passthrough(),
      })
      .passthrough(),
  })
  .passthrough();
const timelineSchema = z
  .object({
    data: z
      .array(
        z
          .object({
            id: idField,
            attachments: z
              .object({ media_keys: z.array(z.string()).optional() })
              .passthrough()
              .optional(),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();

function parsed<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, body: unknown, what: string): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new AppError("unavailable", undefined, `X answered an unexpected shape (${what}).`);
  }
  return result.data;
}

async function readSettings(ctx: TokenContext): Promise<XSettings> {
  const settings = settingsSchema.safeParse(await readChannelSettings(ctx.db, "x"));
  if (!settings.success) {
    throw new AppError("server", undefined, "settings.x needs user_id and handle.");
  }
  return settings.data;
}

/** The reads spent this UTC month and the monthly allowance; an allowance not measured yet counts as 0. */
function budget(settings: XSettings, now: Date) {
  const month = now.toISOString().slice(0, 7);
  return {
    reads: settings.usage?.month === month ? settings.usage.reads : 0,
    allowance: settings.read_allowance ?? 0,
  };
}

const permalink = (settings: XSettings, id: string) =>
  `https://x.com/${settings.handle}/status/${id}`;

// X takes RFC 3339 to the second.
const startTime = (since: Date) => since.toISOString().replace(/\.\d{3}Z$/, "Z");

async function publishCover(
  ctx: StepContext,
  asset: SocialAsset,
  onMarker: ((marker: string) => Promise<void>) | undefined,
): Promise<Posted> {
  const [file] = filesFor("x", asset);
  if (file === undefined) {
    throw new AppError("asset_incomplete", undefined, "The asset has no x file.");
  }
  const text = captionFor("x", asset);
  if (text === null) {
    throw new AppError("asset_incomplete", undefined, "The asset has no X caption.");
  }
  const settings = await readSettings(ctx);
  const bytes = await mediaBytes(file.media_key, ctx.signal);
  const form = new FormData();
  form.set("media", bytes, file.media_key.split("/").pop() ?? "cover");
  form.set("media_category", "tweet_image");
  const upload = await callApi(ctx, "x", `${API}/media/upload`, { method: "POST", body: form });
  const mediaId = parsed(uploadSchema, upload.body, "media upload").data.id;
  await onMarker?.(`inflight:${ctx.now.toISOString()}:media:${mediaId}`);
  const created = await callApi(ctx, "x", `${API}/tweets`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, media: { media_ids: [mediaId] } }),
  });
  const id = parsed(createSchema, created.body, "post").data.id;
  return { status: "posted", remoteId: id, permalink: permalink(settings, id) };
}

/** The adapter of `x`. */
export function createXChannel(): XChannel {
  const supports: Channel["supports"] = (kind) => targetsFor(kind, {}).includes("x");
  return {
    id: "x",
    supports,

    async publish(asset, ctx, onMarker) {
      if (!supports(asset.kind)) {
        throw new AppError("invalid_kind", undefined, `x does not post a ${asset.kind}.`);
      }
      return publishCover(ctx, asset, onMarker);
    },

    async findRecentPost(marker, since, ctx) {
      const mediaId = INFLIGHT.exec(marker)?.[1];
      if (mediaId === undefined) {
        throw new AppError("server", undefined, "The marker is not an X media marker.");
      }
      const settings = await readSettings(ctx);
      const { reads, allowance } = budget(settings, ctx.now);
      if (reads >= allowance) return { status: "skipped_budget" };
      const query = new URLSearchParams({
        start_time: startTime(since),
        expansions: "attachments.media_keys",
      });
      const { body } = await callApi(
        ctx,
        "x",
        `${API}/users/${settings.user_id}/tweets?${query.toString()}`,
        {},
      );
      const key = `3_${mediaId}`;
      const match = (parsed(timelineSchema, body, "timeline").data ?? []).find(
        (post) => post.attachments?.media_keys?.includes(key) === true,
      );
      return match === undefined
        ? { status: "not_found" }
        : { status: "posted", remoteId: match.id, permalink: permalink(settings, match.id) };
    },

    async metrics(post, ctx) {
      const { reads, allowance } = budget(await readSettings(ctx), ctx.now);
      if (reads >= allowance * METRICS_SHARE) return { status: "skipped_budget" };
      const { body } = await callApi(
        ctx,
        "x",
        `${API}/tweets/${post.remoteId}?tweet.fields=public_metrics`,
        {},
      );
      const counts = parsed(metricsSchema, body, "metrics").data.public_metrics;
      return {
        status: "fetched",
        metrics: {
          reach: null,
          views: counts.impression_count ?? null,
          saves: null,
          shares: counts.retweet_count ?? null,
          likes: counts.like_count ?? null,
          comments: counts.reply_count ?? null,
          clicks: null,
          fetched_at: ctx.now.toISOString(),
          raw: body,
        },
      };
    },

    async health(ctx) {
      return tokenState(await readChannelSettings(ctx.db, "x"));
    },
  };
}
