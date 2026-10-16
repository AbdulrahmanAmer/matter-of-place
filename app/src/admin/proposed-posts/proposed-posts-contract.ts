import { z } from "zod";

// The shapes the Proposed posts screen reads from the item-10 routes (`/api/admin/proposed-posts`, W8 item 10, ruling
// H116). They are written from item 10's text, because its branch had not been pushed when the screen was built.
// STUB(W8 item 10): import these from `src/domain/proposed-posts.ts` once that file lands and delete this one; the field
// names, the action ids and the three limits below are the lines to compare first.

const proposedChannels = ["instagram", "x", "linkedin"] as const;
type ProposedChannel = (typeof proposedChannels)[number];

const proposedFormats = ["carousel", "single", "reel"] as const;
type ProposedFormat = (typeof proposedFormats)[number];

export const proposedStatuses = [
  "proposed",
  "rejected",
  "approved",
  "scheduled",
  "posted",
] as const;
export type ProposedStatus = (typeof proposedStatuses)[number];

export const proposedChannelLabels: Record<ProposedChannel, string> = {
  instagram: "Instagram",
  x: "X",
  linkedin: "LinkedIn",
};

export const proposedFormatLabels: Record<ProposedFormat, string> = {
  carousel: "Carousel",
  single: "Single post",
  reel: "Reel",
};

export const proposedStatusLabels: Record<ProposedStatus, string> = {
  proposed: "Proposed",
  rejected: "Rejected",
  approved: "Approved",
  scheduled: "Scheduled",
  posted: "Posted",
};

/** What each channel takes in a caption, in characters (item 10: X 280, Instagram 2,200, LinkedIn 3,000). */
export const captionLimits: Record<ProposedChannel, number> = {
  instagram: 2200,
  x: 280,
  linkedin: 3000,
};

/** The matrix actions the three decisions need (item 10): a button shows only for an actor who holds its action. */
export const proposedActions = {
  approve: "proposed_posts.approve",
  reject: "proposed_posts.reject",
  rerender: "proposed_posts.re_render",
} as const;

/** One picture or film of a post. `name` is what a person calls it; `url` is the address the browser loads it from. */
const proposedFileSchema = z.object({
  name: z.string(),
  url: z.string(),
  alt: z.string().default(""),
  w: z.number().int().positive().optional(),
  h: z.number().int().positive().optional(),
  bytes: z.number().int().nonnegative().optional(),
});
export type ProposedFile = z.infer<typeof proposedFileSchema>;

const channelPostSchema = z.object({
  channel: z.enum(proposedChannels),
  format: z.enum(proposedFormats),
  caption: z.string(),
  /** The pictures in order: the slides of a carousel, the one picture of a single post, the cover of a reel on X. */
  images: z.array(proposedFileSchema).default([]),
  reel: z
    .object({ video: proposedFileSchema, poster: proposedFileSchema.nullable() })
    .nullable()
    .default(null),
});
export type ChannelPost = z.infer<typeof channelPostSchema>;

const proposedPostSchema = z.object({
  id: z.string(),
  status: z.enum(proposedStatuses),
  revision: z.number().int(),
  /** A test post: the screen marks it TEST and nothing about it is real. */
  test: z.boolean().default(false),
  /** Who proposed it: an agent's slug ("social") or a person's name. */
  proposer: z.string(),
  /** What it is for ("Fairfield, CT", a request, or null for a brand post). */
  subject_label: z.string().nullable().default(null),
  rejection_note: z.string().nullable().default(null),
  channels: z.array(channelPostSchema),
  created_at: z.string(),
  updated_at: z.string(),
});
export type ProposedPost = z.infer<typeof proposedPostSchema>;

export const proposedPostListSchema = z.object({
  items: z.array(proposedPostSchema),
  total: z.number().int().nonnegative(),
});

const revisionSchema = z.object({
  revision: z.number().int(),
  /** Who asked for this revision: a person or an agent. */
  requested_by: z.string(),
  note: z.string().nullable().default(null),
  created_at: z.string(),
});

/** `GET /api/admin/proposed-posts/:id`: the post and its revisions, newest first. */
export const proposedPostDetailSchema = proposedPostSchema.extend({
  revisions: z.array(revisionSchema).default([]),
});

/** A decision answers the post as it now stands. */
export const proposedDecisionSchema = z.object({
  id: z.string(),
  status: z.enum(proposedStatuses),
});
