import { z } from "zod";
import { assetFileSchema, type AssetFile, type AssetKind } from "../../domain/assets.ts";
import type { SocialChannel } from "../../domain/channels.ts";
import { propertyLink } from "../assets/links.ts";
import { AppError } from "../lib/errors.ts";
import { createMetaChannel } from "./meta.ts";
import type { Channel, SocialAsset } from "./types.ts";

// Which asset goes where (B10 Contract). Every function here is pure: a step reads a file or a caption only through
// `filesFor` and `captionFor`, which pick by `role`, never by position (B9).

interface TargetSettings {
  linkedin?: { multi_image?: boolean | null | undefined } | null | undefined;
}

/**
 * The channels a kind posts to, whatever their `enabled` value: callers that need live channels filter by the
 * `channel_settings` row themselves. A kind with no target (`newsletter_block`, `standalone_email`) gives `[]`.
 */
export function targetsFor(kind: AssetKind, settings: TargetSettings): SocialChannel[] {
  const multiImage = settings.linkedin?.multi_image === true;
  switch (kind) {
    case "carousel":
      return multiImage ? ["instagram", "linkedin"] : ["instagram"];
    case "cover":
      return multiImage ? ["x", "facebook"] : ["x", "linkedin", "facebook"];
    case "story":
      return ["instagram", "facebook"];
    case "reel":
      return ["instagram"];
    case "newsletter_block":
    case "standalone_email":
    case "variants":
      return [];
  }
}

const ROLES: Readonly<Record<string, readonly AssetFile["role"][]>> = {
  "instagram:carousel": ["slide"],
  "instagram:story": ["main"],
  "instagram:reel": ["video", "poster"],
  "x:cover": ["x"],
  "linkedin:cover": ["linkedin"],
  "linkedin:carousel": ["linkedin_set"],
  "facebook:cover": ["main"],
  "facebook:story": ["main"],
};

const filesSchema = z.array(assetFileSchema);

/** The files `channel` posts for this asset, each role in `index` order; a channel and kind that never meet give `[]`. */
export function filesFor(channel: SocialChannel, asset: SocialAsset): AssetFile[] {
  const files = filesSchema.parse(asset.files);
  return (ROLES[`${channel}:${asset.kind}`] ?? []).flatMap((role) =>
    files.filter((file) => file.role === role).sort((a, b) => (a.index ?? 0) - (b.index ?? 0)),
  );
}

const captionsSchema = z.object({
  captions: z.object({ x: z.string().optional(), linkedin: z.string().optional() }).optional(),
});

/** The caption `channel` posts, or null when the asset holds none for it. Facebook has no variant of its own yet. */
export function captionFor(channel: SocialChannel, asset: SocialAsset): string | null {
  const captions = captionsSchema.safeParse(asset.meta).data?.captions;
  switch (channel) {
    case "instagram":
      return asset.caption;
    case "x":
      return captions?.x ?? null;
    case "linkedin":
      return captions?.linkedin ?? null;
    case "facebook":
      return captions?.linkedin === undefined
        ? null
        : `${captions.linkedin}\n\n${propertyLink(asset.property_slug, "facebook")}`;
    case "youtube":
      return null;
  }
}

function disabledBlock(id: SocialChannel): Channel {
  return {
    id,
    supports: () => false,
    publish: () => Promise.resolve({ status: "skipped_disabled" }),
    metrics: () => Promise.resolve({ status: "skipped_disabled" }),
    health: () => Promise.resolve({ state: "disabled" }),
  };
}

// Adapters are built on demand: `meta.ts` imports the pure functions above, so a registry that built them at load
// would read this module half evaluated.
// STUB(B10 step 5a): x, linkedin and youtube register here
const adapters: Partial<Record<SocialChannel, () => Channel>> = {
  instagram: () => createMetaChannel("instagram"),
  facebook: () => createMetaChannel("facebook"),
};

/** The adapter of `name`, or the disabled block when its `channel_settings` row is `enabled = false`. */
export function getChannel(name: SocialChannel, enabled: boolean): Channel {
  if (!enabled) return disabledBlock(name);
  const adapter = adapters[name];
  if (adapter === undefined) {
    throw new AppError("server", undefined, `No adapter is registered for ${name}.`);
  }
  return adapter();
}
