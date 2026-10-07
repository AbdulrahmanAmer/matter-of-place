import { z } from "zod";
import type { Json } from "../../db/index.ts";
import type { AssetFile } from "../../domain/assets.ts";
import type { StepContext } from "../jobs/types.ts";
import { hmacSha256, toHex } from "../lib/crypto.ts";
import { AppError } from "../lib/errors.ts";
import { mediaUrl } from "../lib/media-store.ts";
import { liveSideEffects } from "../lib/runtime-env.ts";
import { captionFor, filesFor, targetsFor } from "./index.ts";
import { classifyGraphError } from "./meta-errors.ts";
import { META_METRICS, normaliseMetaInsights } from "./meta-metrics.ts";
import { getMetaToken, tokenHealth } from "./meta-token.ts";
import type { Channel, SocialAsset } from "./types.ts";

// The Meta adapter (B10 step 5, R32): Instagram, and the Facebook Page block that stays behind its flag. Every call
// goes to `https://graph.facebook.com/<settings.meta.graph_version>` with the Page token and an `appsecret_proof`
// (CS-04), a write goes out only when `liveSideEffects("social")` says so (R35), and every answer is parsed before it
// is read (R33). The posting window, the exactly-once markers and the alerts belong to `postToChannel`.

const GRAPH_ORIGIN = "https://graph.facebook.com";
const POLL_EVERY_MS = 5_000;
// Five asks with four waits between them: 20 seconds, inside the 40-second `timeoutMs` of `post_meta` (JOB-02).
const POLL_CALLS = 5;
const CONTAINER_PREFIX = "container:";

type Classified = ReturnType<typeof classifyGraphError>;

/** A Graph answer that was not 2xx, or a container Meta gave up on: `detail.class` tells the caller what to do next. */
export class GraphError extends Error {
  readonly detail: Classified;

  constructor(detail: Classified) {
    super(detail.message);
    this.name = "GraphError";
    this.detail = detail;
  }
}

type Posted = { status: "posted"; remoteId: string; permalink: string };
type InProgress = { status: "in_progress"; containerId: string };
/** What a stored marker leads to: the post, the container still processing, or what the caller must decide. */
type Resumed = Posted | InProgress | { status: "restart" } | { status: "not_found" };

/**
 * `publish` and `findRecentPost` are the adapter's two ways in. `onContainer` is awaited with the marker
 * `container:<id>` as soon as the container exists and before anything is asked of it, so the caller stores it
 * before a crash can lose the handle (R28). A `restart` answer means the container ended `ERROR` or `EXPIRED`: the
 * caller clears its marker and publishes again. `not_found` means no media (a Page post, for Facebook) at or after
 * `since` was found, which for a `PUBLISHED` container leaves the outcome unknown.
 */
export interface MetaChannel extends Channel {
  publish(
    asset: SocialAsset,
    ctx: StepContext,
    onContainer?: (marker: string) => Promise<void>,
  ): ReturnType<Channel["publish"]>;
  findRecentPost(marker: string, since: Date, ctx: StepContext): Promise<Resumed>;
}

const jsonValue: z.ZodType<Json> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValue),
    z.record(z.string(), jsonValue),
  ]),
);

const idField = z.string().min(1);
const settingsSchema = z
  .object({ page_id: idField, ig_user_id: idField, graph_version: idField })
  .passthrough();
const idSchema = z.object({ id: idField }).passthrough();
const statusSchema = z
  .object({ status_code: z.enum(["IN_PROGRESS", "FINISHED", "PUBLISHED", "ERROR", "EXPIRED"]) })
  .passthrough();
const permalinkSchema = z.object({ permalink: idField }).passthrough();
const pagePermalinkSchema = z.object({ permalink_url: idField }).passthrough();
const photoSchema = z.object({ id: idField, post_id: idField.optional() }).passthrough();
const photoStorySchema = z.object({ post_id: idField }).passthrough();
const mediaListSchema = z
  .object({
    data: z.array(
      z.object({ id: idField, timestamp: z.string(), permalink: idField }).passthrough(),
    ),
  })
  .passthrough();
const postListSchema = z
  .object({
    data: z.array(
      z.object({ id: idField, created_time: z.string(), permalink_url: idField }).passthrough(),
    ),
  })
  .passthrough();

interface Session {
  ctx: StepContext;
  base: string;
  igUserId: string;
  pageId: string;
  token: string;
  proof: string;
}

async function readMetaSettings(ctx: StepContext): Promise<unknown> {
  const { data, error } = await ctx.db.from("settings").select("value").eq("key", "meta");
  if (error !== null) {
    throw new AppError("unavailable", undefined, "The settings could not be read.");
  }
  return data[0]?.value;
}

async function connect(ctx: StepContext): Promise<Session> {
  const settings = settingsSchema.safeParse(await readMetaSettings(ctx));
  if (!settings.success) {
    throw new AppError(
      "server",
      undefined,
      "settings.meta needs page_id, ig_user_id and graph_version.",
    );
  }
  const secret = ctx.env["META_APP_SECRET"];
  if (secret === undefined || secret === "") {
    throw new AppError("server", undefined, "META_APP_SECRET is not set.");
  }
  const token = await getMetaToken(ctx.db);
  return {
    ctx,
    base: `${GRAPH_ORIGIN}/${settings.data.graph_version}`,
    igUserId: settings.data.ig_user_id,
    pageId: settings.data.page_id,
    token,
    proof: toHex(await hmacSha256(secret, token)),
  };
}

/**
 * One Graph call. A GET carries the token and the proof in its query, a POST in its form body, so a write never
 * puts them in a URL. A rejection is replaced by a message without the URL, because a runtime's network error quotes
 * it and the job's error is stored and shown to staff.
 */
async function graph(
  session: Session,
  method: "GET" | "POST",
  path: string,
  params: Record<string, string>,
): Promise<Json> {
  if (method === "POST" && !liveSideEffects("social")) {
    throw new AppError(
      "server",
      undefined,
      "Posting is switched off here: no write call was made.",
    );
  }
  const form = new URLSearchParams({
    ...params,
    access_token: session.token,
    appsecret_proof: session.proof,
  });
  const signal = session.ctx.signal;
  let response: Response;
  try {
    response =
      method === "GET"
        ? await fetch(`${session.base}/${path}?${form.toString()}`, { signal })
        : await fetch(`${session.base}/${path}`, { method, body: form, signal });
  } catch {
    throw new AppError("unavailable", undefined, "Graph did not answer.");
  }
  let body: Json = null;
  try {
    body = jsonValue.parse(await response.json());
  } catch {
    body = null;
  }
  if (!response.ok) throw new GraphError(classifyGraphError(response.status, body));
  return body;
}

function parsed<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, body: Json, what: string): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new AppError("unavailable", undefined, `Graph answered an unexpected shape (${what}).`);
  }
  return result.data;
}

async function call<T>(
  session: Session,
  method: "GET" | "POST",
  path: string,
  params: Record<string, string>,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  what: string,
): Promise<T> {
  return parsed(schema, await graph(session, method, path, params), what);
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const incomplete = (role: string) =>
  new AppError("asset_incomplete", undefined, `The asset has no ${role} file.`);

const publicUrl = (file: AssetFile) => mediaUrl(file.media_key, { absolute: true });

const createMedia = async (session: Session, params: Record<string, string>) =>
  (await call(session, "POST", `${session.igUserId}/media`, params, idSchema, "container")).id;

/** The container of an Instagram asset; a carousel's children come first, then the parent that names them. */
async function createContainer(session: Session, asset: SocialAsset): Promise<string> {
  const files = filesFor("instagram", asset);
  const caption = captionFor("instagram", asset);
  const withCaption: Record<string, string> = caption === null ? {} : { caption };
  if (asset.kind === "story") {
    const [main] = files;
    if (main === undefined) throw incomplete("main");
    return createMedia(session, { media_type: "STORIES", image_url: publicUrl(main) });
  }
  if (asset.kind === "reel") {
    const video = files.find((file) => file.role === "video");
    const poster = files.find((file) => file.role === "poster");
    if (video === undefined) throw incomplete("video");
    return createMedia(session, {
      media_type: "REELS",
      video_url: publicUrl(video),
      share_to_feed: "true",
      ...(poster === undefined ? {} : { cover_url: publicUrl(poster) }),
      ...withCaption,
    });
  }
  const [first, ...others] = files;
  if (first === undefined) throw incomplete("slide");
  if (others.length === 0) {
    return createMedia(session, { image_url: publicUrl(first), ...withCaption });
  }
  const children: string[] = [];
  for (const slide of files) {
    children.push(
      await createMedia(session, { image_url: publicUrl(slide), is_carousel_item: "true" }),
    );
  }
  return createMedia(session, {
    media_type: "CAROUSEL",
    children: children.join(","),
    ...withCaption,
  });
}

/** Asks for the container's status up to `POLL_CALLS` times and stops at the first answer that is not `IN_PROGRESS`. */
async function waitForContainer(session: Session, containerId: string) {
  for (let asked = 1; ; asked += 1) {
    const { status_code: status } = await call(
      session,
      "GET",
      containerId,
      { fields: "status_code" },
      statusSchema,
      "status",
    );
    if (status !== "IN_PROGRESS" || asked === POLL_CALLS) return status;
    await sleep(POLL_EVERY_MS);
  }
}

/** The newest entry at or after `since`: the order Graph lists them in is not relied on. */
function newestSince(
  entries: readonly { id: string; at: string; permalink: string }[],
  since: Date,
): Posted | { status: "not_found" } {
  const [newest] = entries
    .map((entry) => ({ entry, time: Date.parse(entry.at) }))
    .filter(({ time }) => !Number.isNaN(time) && time >= since.getTime())
    .sort((a, b) => b.time - a.time);
  return newest === undefined
    ? { status: "not_found" }
    : { status: "posted", remoteId: newest.entry.id, permalink: newest.entry.permalink };
}

async function adoptInstagramMedia(session: Session, since: Date) {
  const list = await call(
    session,
    "GET",
    `${session.igUserId}/media`,
    { fields: "caption,timestamp,permalink" },
    mediaListSchema,
    "media list",
  );
  return newestSince(
    list.data.map((media) => ({ id: media.id, at: media.timestamp, permalink: media.permalink })),
    since,
  );
}

async function adoptFacebookPost(session: Session, since: Date) {
  const list = await call(
    session,
    "GET",
    `${session.pageId}/posts`,
    { fields: "message,created_time,permalink_url" },
    postListSchema,
    "post list",
  );
  return newestSince(
    list.data.map((post) => ({
      id: post.id,
      at: post.created_time,
      permalink: post.permalink_url,
    })),
    since,
  );
}

/** Publishes a container that is `FINISHED`; the permalink is read after, so a failed read never repeats the post. */
async function publishContainer(session: Session, containerId: string): Promise<Posted> {
  const media = await call(
    session,
    "POST",
    `${session.igUserId}/media_publish`,
    { creation_id: containerId },
    idSchema,
    "publish",
  );
  const { permalink } = await call(
    session,
    "GET",
    media.id,
    { fields: "permalink" },
    permalinkSchema,
    "permalink",
  );
  return { status: "posted", remoteId: media.id, permalink };
}

/** Where a container has got to, and the one step that follows: publish on `FINISHED`, adopt on `PUBLISHED`. */
async function settleContainer(
  session: Session,
  containerId: string,
  since: Date,
): Promise<Resumed> {
  const status = await waitForContainer(session, containerId);
  if (status === "IN_PROGRESS") return { status: "in_progress", containerId };
  if (status === "ERROR" || status === "EXPIRED") return { status: "restart" };
  if (status === "FINISHED") return publishContainer(session, containerId);
  return adoptInstagramMedia(session, since);
}

async function publishInstagram(
  session: Session,
  asset: SocialAsset,
  onContainer: ((marker: string) => Promise<void>) | undefined,
): Promise<Posted | InProgress> {
  const containerId = await createContainer(session, asset);
  await onContainer?.(`${CONTAINER_PREFIX}${containerId}`);
  const settled = await settleContainer(session, containerId, session.ctx.now);
  if (settled.status === "restart") {
    throw new GraphError({
      class: "non_retryable",
      code: null,
      subcode: null,
      message: `Container ${containerId} ended ERROR or EXPIRED.`,
    });
  }
  if (settled.status === "not_found") {
    throw new AppError(
      "server",
      undefined,
      `Container ${containerId} is PUBLISHED but no media was found since this run began.`,
    );
  }
  return settled;
}

/** A Page photo post, or a photo story: the photo is uploaded unpublished, then published to `photo_stories`. */
async function publishFacebook(session: Session, asset: SocialAsset): Promise<Posted> {
  const [file] = filesFor("facebook", asset);
  if (file === undefined) throw incomplete("main");
  const url = publicUrl(file);
  const photos = `${session.pageId}/photos`;
  let postId: string;
  if (asset.kind === "story") {
    const photo = await call(
      session,
      "POST",
      photos,
      { url, published: "false" },
      photoSchema,
      "photo",
    );
    ({ post_id: postId } = await call(
      session,
      "POST",
      `${session.pageId}/photo_stories`,
      { photo_id: photo.id },
      photoStorySchema,
      "photo story",
    ));
  } else {
    const caption = captionFor("facebook", asset);
    const photo = await call(
      session,
      "POST",
      photos,
      { url, ...(caption === null ? {} : { caption }) },
      photoSchema,
      "photo",
    );
    postId = photo.post_id ?? photo.id;
  }
  const { permalink_url: permalink } = await call(
    session,
    "GET",
    postId,
    { fields: "permalink_url" },
    pagePermalinkSchema,
    "permalink",
  );
  return { status: "posted", remoteId: postId, permalink };
}

/** The adapter of `instagram` or `facebook`: the same Page token and app secret, two sets of calls. */
export function createMetaChannel(channel: "instagram" | "facebook"): MetaChannel {
  const supports: Channel["supports"] = (kind) => targetsFor(kind, {}).includes(channel);
  return {
    id: channel,
    supports,

    async publish(asset, ctx, onContainer) {
      if (!supports(asset.kind)) {
        throw new AppError("invalid_kind", undefined, `${channel} does not post a ${asset.kind}.`);
      }
      const session = await connect(ctx);
      return channel === "facebook"
        ? publishFacebook(session, asset)
        : publishInstagram(session, asset, onContainer);
    },

    async findRecentPost(marker, since, ctx) {
      const session = await connect(ctx);
      if (channel === "facebook") return adoptFacebookPost(session, since);
      if (!marker.startsWith(CONTAINER_PREFIX)) {
        throw new AppError("server", undefined, "The marker is not a Meta container marker.");
      }
      return settleContainer(session, marker.slice(CONTAINER_PREFIX.length), since);
    },

    // Page post insights are not in the plan's call list: the Page block answers `skipped_disabled` until step 3
    // names the metrics it reads.
    async metrics(post, ctx) {
      if (channel === "facebook") return { status: "skipped_disabled" };
      const session = await connect(ctx);
      const answer = await graph(session, "GET", `${post.remoteId}/insights`, {
        metric: Object.keys(META_METRICS).join(","),
      });
      return { status: "fetched", metrics: normaliseMetaInsights(answer, ctx.now) };
    },

    async health(ctx) {
      const { expiresAt, level } = tokenHealth(await readMetaSettings(ctx), ctx.now);
      return {
        state: level,
        detail:
          expiresAt === "never"
            ? "The token does not expire."
            : `The token expires on ${expiresAt.slice(0, 10)}.`,
      };
    },
  };
}
