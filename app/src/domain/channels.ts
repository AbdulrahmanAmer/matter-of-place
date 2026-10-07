import { z } from "zod";
import type { Channel } from "./automation.ts";

// The social channels of B10 (S48) and the account ids a human stores for each (`channels.ids_put`). Tokens never
// appear here: they live in Vault and the function secrets, and `channelIdsSchema` refuses any field it does not name.

const socialChannels = [
  "instagram",
  "x",
  "linkedin",
  "facebook",
  "youtube",
] as const satisfies readonly Channel[];

export type SocialChannel = (typeof socialChannels)[number];

/** @public The database enum `social_post_status`; `enums.check.ts` holds the pair. */
export const socialPostStatuses = ["scheduled", "posted", "failed"] as const;

/** @public */
// STUB(B10 step 8): the channel cards and the posts table of screen 12 read the labels
export const socialChannelLabels: Record<SocialChannel, string> = {
  instagram: "Instagram",
  x: "X",
  linkedin: "LinkedIn",
  facebook: "Facebook",
  youtube: "YouTube",
};

/** @public */
// STUB(B10 step 8): the posts table of screen 12 reads the labels
export const socialPostStatusLabels: Record<(typeof socialPostStatuses)[number], string> = {
  scheduled: "Scheduled",
  posted: "Posted",
  failed: "Failed",
};

/** The query of `GET /api/admin/channels/posts`: `post_id` is the `?post=` link of a failure mail, `withdraw` the list of
 * taken-down posts a person still deletes by hand (invariant 10). */
export const socialPostFilters = z.object({
  channel: z.enum(socialChannels).optional(),
  status: z.enum(socialPostStatuses).optional(),
  post_id: z.string().uuid().optional(),
  withdraw: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
});

export type SocialPostFilters = z.output<typeof socialPostFilters>;

export const socialPostSchema = z.object({
  id: z.string().uuid(),
  asset_id: z.string().uuid(),
  property_id: z.string().uuid(),
  channel: z.enum(socialChannels),
  status: z.enum(socialPostStatuses),
  scheduled_at: z.string(),
  posted_at: z.string().nullable(),
  remote_id: z.string().nullable(),
  permalink: z.string().nullable(),
  metrics: z.record(z.string(), z.unknown()),
  error: z.string().nullable(),
  withdraw_required_at: z.string().nullable(),
  withdrawn_at: z.string().nullable(),
});

export type SocialPost = z.infer<typeof socialPostSchema>;

export const socialPostListSchema = z.object({
  items: z.array(socialPostSchema),
  total: z.number().int().min(0),
});

const channelIdsKeys = ["meta", "x", "linkedin"] as const;

export type ChannelIdsKey = (typeof channelIdsKeys)[number];

/** `PUT /api/admin/channels/ids/:key`: the key from the path, the fields checked by `channelIdsSchema[key]`. */
export const channelIdsInputSchema = z.object({ key: z.enum(channelIdsKeys) }).passthrough();

export const channelIdsAnswerSchema = z.object({
  key: z.enum(channelIdsKeys),
  value: z.record(z.string(), z.unknown()),
});

const numericId = z.string().regex(/^\d+$/, "Use the numeric id");

// Every field is optional because each writer stores its own fields (`x-authorize.ts` the handle, `x-limits-check.ts`
// the allowance, screen 12 the rest); the object is strict, so a token or any other key is refused.
export const channelIdsSchema = {
  meta: z
    .strictObject({
      page_id: numericId,
      ig_user_id: numericId,
      graph_version: z.string().regex(/^v\d+\.\d+$/, "Use a version such as v23.0"),
    })
    .partial(),
  x: z
    .strictObject({
      user_id: numericId,
      handle: z.string().regex(/^[A-Za-z0-9_]{1,15}$/, "Use the handle without the @"),
      read_allowance: z.number().int().min(0),
      metrics_days: z.array(z.number().int().min(1).max(365)),
    })
    .partial(),
  linkedin: z
    .strictObject({
      organization_urn: z
        .string()
        .regex(/^urn:li:organization:\d+$/, "Use urn:li:organization:<id>"),
      api_version: z.string().regex(/^\d{6}$/, "Use the YYYYMM version"),
      multi_image: z.boolean(),
    })
    .partial(),
} as const;
