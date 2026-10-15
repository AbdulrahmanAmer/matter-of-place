import { z } from "zod";
import type { ChannelStatus } from "./rows.ts";

// The campaigns list of screen 33 (W7 item 3). One row is one `campaigns` row: the paid package of one property, its
// two money figures, its dates and the status of each channel. There is no state column; the screen derives the state
// from the dates. The list is read only.

/** The most campaigns `GET /api/admin/campaigns` answers; the newest come first and `total` says how many exist. */
export const campaignListLimit = 200;

/** `channel_status` of the migration; a value the database drops fails this line. */
export const channelStatusSchema = z.enum([
  "none",
  "planned",
  "active",
  "done",
]) satisfies z.ZodType<ChannelStatus>;

/** The five channels of a campaign, in the order the screen writes them. */
export const campaignChannels = [
  "homepage",
  "featured",
  "newsletter",
  "social",
  "programmatic",
] as const;

export const campaignSchema = z.object({
  id: z.string().uuid(),
  property_id: z.string().uuid(),
  property_title: z.string(),
  market_slug: z.string(),
  package: z.string(),
  media_budget: z.number(),
  management_fee: z.number(),
  starts_on: z.string().nullable(),
  ends_on: z.string().nullable(),
  channels: z.object({
    homepage: channelStatusSchema,
    featured: channelStatusSchema,
    newsletter: channelStatusSchema,
    social: channelStatusSchema,
    programmatic: channelStatusSchema,
  }),
  /** How many weekly reports the campaign has; the screen links to them when it is above 0. */
  report_count: z.number().int().min(0),
});

export type Campaign = z.infer<typeof campaignSchema>;

export const campaignListSchema = z.object({
  items: z.array(campaignSchema),
  total: z.number().int().min(0),
});

export type CampaignList = z.infer<typeof campaignListSchema>;
