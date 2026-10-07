import { z } from "zod";
import type { AssetKind } from "../../domain/assets.ts";
import type { StepContext } from "../jobs/types.ts";
import { AppError } from "../lib/errors.ts";
import { captionFor, filesFor, targetsFor } from "./index.ts";
import {
  callApi,
  linkedInHeaders,
  mediaBytes,
  readChannelSettings,
  tokenState,
} from "./oauth-tokens.ts";
import type { Channel, SocialAsset } from "./types.ts";

// The LinkedIn adapter (B10 step 5a, R32): an organisation post with the cover's `role: linkedin` file, or with the
// carousel's `role: linkedin_set` files as one multi-image post when `settings.linkedin.multi_image` sends carousels
// here. Each image is fetched from its public address, registered with `initializeUpload` and uploaded, then the post
// is created. Every call carries the pinned `LinkedIn-Version` and the Rest.li protocol header. Step 3b confirms the
// calls against the approved product.

const API = "https://api.linkedin.com/rest";
const INFLIGHT = /^inflight:.+:image:(urn:li:image:.+)$/;

type Posted = { status: "posted"; remoteId: string; permalink: string };

/**
 * `publish` awaits `onMarker` with `inflight:<UTC timestamp>:image:<image URN>` (the first image's URN) once every
 * image is uploaded and before the post is created, so the caller stores the handle first (R28). `findRecentPost`
 * adopts only the organisation's post whose image, or one of whose images, is that URN; it never compares text.
 */
export interface LinkedInChannel extends Channel {
  publish(
    asset: SocialAsset,
    ctx: StepContext,
    onMarker?: (marker: string) => Promise<void>,
  ): ReturnType<Channel["publish"]>;
  findRecentPost(
    marker: string,
    since: Date,
    ctx: StepContext,
  ): Promise<Posted | { status: "not_found" }>;
}

const idField = z.string().min(1);
const settingsSchema = z.object({ organization_urn: idField, api_version: idField }).passthrough();
type LinkedInSettings = z.infer<typeof settingsSchema>;

const uploadSchema = z
  .object({
    value: z.object({ uploadUrl: z.string().url(), image: idField }).passthrough(),
  })
  .passthrough();
const postsSchema = z
  .object({
    elements: z.array(
      z
        .object({
          id: idField,
          content: z
            .object({
              media: z.object({ id: z.string() }).passthrough().optional(),
              multiImage: z
                .object({ images: z.array(z.object({ id: z.string() }).passthrough()) })
                .passthrough()
                .optional(),
            })
            .passthrough()
            .optional(),
        })
        .passthrough(),
    ),
  })
  .passthrough();
const count = z.number().optional();
const statisticsSchema = z
  .object({
    elements: z.array(
      z
        .object({
          totalShareStatistics: z
            .object({
              impressionCount: count,
              clickCount: count,
              likeCount: count,
              commentCount: count,
              shareCount: count,
            })
            .passthrough(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

function parsed<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, body: unknown, what: string): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new AppError(
      "unavailable",
      undefined,
      `LinkedIn answered an unexpected shape (${what}).`,
    );
  }
  return result.data;
}

async function readSettings(ctx: StepContext): Promise<LinkedInSettings> {
  const settings = settingsSchema.safeParse(await readChannelSettings(ctx.db, "linkedin"));
  if (!settings.success) {
    throw new AppError(
      "server",
      undefined,
      "settings.linkedin needs organization_urn and api_version.",
    );
  }
  return settings.data;
}

// The post commentary is LinkedIn's "little text": these characters are markup unless escaped with a backslash.
const escapeCommentary = (text: string) =>
  text.replace(/[\\|{}@[\]()<>#*_~]/g, (char) => `\\${char}`);

const permalink = (urn: string) => `https://www.linkedin.com/feed/update/${urn}/`;

/** Fetches every image first, so a file that does not answer stops the post before anything is uploaded. */
async function uploadImages(ctx: StepContext, settings: LinkedInSettings, keys: string[]) {
  const headers = linkedInHeaders(settings.api_version);
  const images: Blob[] = [];
  for (const key of keys) images.push(await mediaBytes(key, ctx.signal));
  const urns: string[] = [];
  for (const bytes of images) {
    const init = await callApi(ctx, "linkedin", `${API}/images?action=initializeUpload`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ initializeUploadRequest: { owner: settings.organization_urn } }),
    });
    const { uploadUrl, image } = parsed(uploadSchema, init.body, "initializeUpload").value;
    await callApi(ctx, "linkedin", uploadUrl, { method: "PUT", headers, body: bytes });
    urns.push(image);
  }
  return urns;
}

async function publishPost(
  ctx: StepContext,
  asset: SocialAsset,
  onMarker: ((marker: string) => Promise<void>) | undefined,
): Promise<Posted> {
  const files = filesFor("linkedin", asset);
  if (files.length === 0) {
    throw new AppError("asset_incomplete", undefined, "The asset has no LinkedIn file.");
  }
  const caption = captionFor("linkedin", asset);
  if (caption === null) {
    throw new AppError("asset_incomplete", undefined, "The asset has no LinkedIn caption.");
  }
  const settings = await readSettings(ctx);
  const urns = await uploadImages(
    ctx,
    settings,
    files.map((file) => file.media_key),
  );
  const [first] = urns;
  if (first === undefined)
    throw new AppError("asset_incomplete", undefined, "No image was uploaded.");
  await onMarker?.(`inflight:${ctx.now.toISOString()}:image:${first}`);
  const content =
    urns.length === 1
      ? { media: { id: first } }
      : { multiImage: { images: urns.map((id) => ({ id })) } };
  const created = await callApi(ctx, "linkedin", `${API}/posts`, {
    method: "POST",
    headers: { ...linkedInHeaders(settings.api_version), "Content-Type": "application/json" },
    body: JSON.stringify({
      author: settings.organization_urn,
      commentary: escapeCommentary(caption),
      visibility: "PUBLIC",
      distribution: {
        feedDistribution: "MAIN_FEED",
        targetEntities: [],
        thirdPartyDistributionChannels: [],
      },
      content,
      lifecycleState: "PUBLISHED",
      isReshareDisabledByAuthor: false,
    }),
  });
  const urn = created.headers.get("x-restli-id");
  if (urn === null || urn === "") {
    throw new AppError("unavailable", undefined, "LinkedIn created the post but named no id.");
  }
  return { status: "posted", remoteId: urn, permalink: permalink(urn) };
}

const supportedKinds = (kind: AssetKind) =>
  [targetsFor(kind, {}), targetsFor(kind, { linkedin: { multi_image: true } })].some((targets) =>
    targets.includes("linkedin"),
  );

/** The adapter of `linkedin`. */
export function createLinkedInChannel(): LinkedInChannel {
  return {
    id: "linkedin",
    supports: supportedKinds,

    async publish(asset, ctx, onMarker) {
      if (!supportedKinds(asset.kind)) {
        throw new AppError("invalid_kind", undefined, `linkedin does not post a ${asset.kind}.`);
      }
      return publishPost(ctx, asset, onMarker);
    },

    async findRecentPost(marker, _since, ctx) {
      const image = INFLIGHT.exec(marker)?.[1];
      if (image === undefined) {
        throw new AppError("server", undefined, "The marker is not a LinkedIn image marker.");
      }
      const settings = await readSettings(ctx);
      const author = encodeURIComponent(settings.organization_urn);
      const { body } = await callApi(ctx, "linkedin", `${API}/posts?q=author&author=${author}`, {
        headers: { ...linkedInHeaders(settings.api_version), "X-RestLi-Method": "FINDER" },
      });
      const match = parsed(postsSchema, body, "posts").elements.find(
        (post) =>
          post.content?.media?.id === image ||
          post.content?.multiImage?.images.some((entry) => entry.id === image) === true,
      );
      return match === undefined
        ? { status: "not_found" }
        : { status: "posted", remoteId: match.id, permalink: permalink(match.id) };
    },

    async metrics(post, ctx) {
      const settings = await readSettings(ctx);
      const list = post.remoteId.startsWith("urn:li:ugcPost:") ? "ugcPosts" : "shares";
      const query = [
        "q=organizationalEntity",
        `organizationalEntity=${encodeURIComponent(settings.organization_urn)}`,
        `${list}=List(${encodeURIComponent(post.remoteId)})`,
      ].join("&");
      const { body } = await callApi(
        ctx,
        "linkedin",
        `${API}/organizationalEntityShareStatistics?${query}`,
        { headers: linkedInHeaders(settings.api_version) },
      );
      const totals = parsed(statisticsSchema, body, "statistics").elements[0]?.totalShareStatistics;
      return {
        status: "fetched",
        metrics: {
          reach: null,
          views: totals?.impressionCount ?? null,
          saves: null,
          shares: totals?.shareCount ?? null,
          likes: totals?.likeCount ?? null,
          comments: totals?.commentCount ?? null,
          clicks: totals?.clickCount ?? null,
          fetched_at: ctx.now.toISOString(),
          raw: body,
        },
      };
    },

    async health(ctx) {
      return tokenState(await readChannelSettings(ctx.db, "linkedin"));
    },
  };
}
