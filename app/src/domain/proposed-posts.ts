import { z } from "zod";
import { adminPageAnswer, adminPageSchema } from "./admin-page.ts";
import type { SocialChannel } from "./channels.ts";

// W8 item 10 (rulings H116, H134): a post a colleague or a person proposes, before it is anything a channel posts. The
// channel rules here are the ones `proposed_post_put_channels` enforces again in SQL, so a refusal reads the same from
// the admin route and from the laptop runner. API JSON is the snake_case row shape, as the other admin areas.

/** The channels a post may go to now; Facebook and YouTube exist as disabled channel blocks (S48) and are refused. */
const proposedChannels = ["instagram", "x", "linkedin"] as const satisfies readonly SocialChannel[];
type ProposedChannel = (typeof proposedChannels)[number];
const disabledChannels = ["facebook", "youtube"] as const satisfies readonly SocialChannel[];

const postFormats = ["carousel", "single", "reel"] as const;

/** The database enum `proposed_post_status`; `enums.check.ts` holds the pair. */
const proposedPostStatuses = ["proposed", "rejected", "approved", "scheduled", "posted"] as const;
export type ProposedPostStatus = (typeof proposedPostStatuses)[number];

/**
 * The status machine. A person's yes passes `approved` and lands on `scheduled` in one transaction, once each channel
 * has its `social_posts` row; a test post stays `approved`, its rows closed as cancelled. Once every row is posted or
 * cancelled (a format the post steps skip), the post is `posted`, or back to `approved` when none posted. A rejected
 * post comes back as its next revision.
 */
const proposedPostTransitions: Record<ProposedPostStatus, readonly ProposedPostStatus[]> = {
  proposed: ["approved", "rejected"],
  rejected: ["proposed"],
  approved: ["scheduled"],
  scheduled: ["posted", "approved"],
  posted: [],
};

export function canMove(from: ProposedPostStatus, to: ProposedPostStatus): boolean {
  return proposedPostTransitions[from].includes(to);
}

/** The longest caption each channel takes, in characters. */
const captionLimits: Record<ProposedChannel, number> = {
  instagram: 2200,
  x: 280,
  linkedin: 3000,
};

/** How many images a single post and a carousel take on each channel. */
const imageCounts: Record<ProposedChannel, Record<"single" | "carousel", [number, number]>> = {
  instagram: { single: [1, 1], carousel: [2, 10] },
  x: { single: [1, 1], carousel: [2, 4] },
  linkedin: { single: [1, 1], carousel: [2, 20] },
};

const channelLabels: Record<ProposedChannel | (typeof disabledChannels)[number], string> = {
  instagram: "Instagram",
  x: "X",
  linkedin: "LinkedIn",
  facebook: "Facebook",
  youtube: "YouTube",
};

const uuid = z.string().uuid();

/**
 * One file of a post: a key in the public `media` bucket (the runner uploads a studio or Drive file first), where it
 * came from and the path a person can open, its alt text and its size.
 */
export const postFileSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1)
    .max(300)
    .regex(/^[A-Za-z0-9][A-Za-z0-9/_.-]*$/, "A storage key."),
  source: z.enum(["studio", "drive", "storage"]),
  original: z.string().max(500).nullable().default(null),
  alt: z.string().trim().min(1, "Each file needs its alt text.").max(1000),
  w: z.number().int().positive(),
  h: z.number().int().positive(),
  bytes: z.number().int().nonnegative(),
});
export type PostFile = z.infer<typeof postFileSchema>;

const reelSchema = z.object({
  video: postFileSchema,
  poster: postFileSchema.nullable().default(null),
});

/** One channel of a post as proposed; Facebook and YouTube parse so that their refusal can say why. */
export const channelPostSchema = z.object({
  channel: z.enum([...proposedChannels, ...disabledChannels]),
  format: z.enum(postFormats),
  caption: z.string().trim().min(1).max(5000),
  images: z.array(postFileSchema).max(20).default([]),
  reel: reelSchema.nullable().default(null),
});
export type ChannelPost = z.infer<typeof channelPostSchema>;

/** What the channel rules read of one channel: the runner checks its plan with them before it uploads anything. */
type ChannelShape = Pick<ChannelPost, "channel" | "format" | "caption"> & {
  images: readonly unknown[];
  reel: { poster: unknown } | null;
};

/** What is wrong with one channel of a post, in the words a person or a colleague reads; empty when nothing is. */
export function channelProblems(post: ChannelShape): string[] {
  const { channel, format } = post;
  const label = channelLabels[channel];
  if (channel === "facebook" || channel === "youtube") {
    return [`${label} is a disabled channel block.`];
  }
  const problems: string[] = [];
  const limit = captionLimits[channel];
  // Counted in code points, as `char_length` counts them in `proposed_post_put_channels`: an emoji is one character.
  const length = [...post.caption].length;
  if (length > limit) {
    problems.push(
      `${label} captions are at most ${String(limit)} characters; this one has ${String(length)}.`,
    );
  }
  if (format === "reel") {
    if (post.reel === null) problems.push(`A reel on ${label} needs its video.`);
    if (post.images.length > 0) problems.push(`A reel on ${label} carries no images.`);
    if (channel === "linkedin" && post.reel !== null && post.reel.poster === null) {
      problems.push("A reel on LinkedIn needs its poster.");
    }
    return problems;
  }
  if (post.reel !== null) problems.push("Only a reel carries a video.");
  const [min, max] = imageCounts[channel][format];
  if (post.images.length < min || post.images.length > max) {
    const takes = min === max ? `${String(min)} image` : `${String(min)} to ${String(max)} images`;
    problems.push(
      `A ${format === "single" ? "single post" : "carousel"} on ${label} takes ${takes}; this one has ${String(post.images.length)}.`,
    );
  }
  return problems;
}

const channelsSchema = z
  .array(channelPostSchema)
  .min(1)
  .max(3)
  .superRefine((channels, ctx) => {
    const seen = new Set<string>();
    channels.forEach((post, index) => {
      if (seen.has(post.channel)) {
        ctx.addIssue({
          code: "custom",
          path: [index, "channel"],
          message: `${channelLabels[post.channel]} is named twice.`,
        });
      }
      seen.add(post.channel);
      for (const message of channelProblems(post)) {
        ctx.addIssue({ code: "custom", path: [index], message });
      }
    });
  });

const title = z.string().trim().min(1).max(200);

/** `POST /api/admin/proposed-posts`: a brand post names neither a property nor a request (item 1). */
export const proposedPostInputSchema = z.object({
  title,
  property_id: uuid.nullable().default(null),
  submission_id: uuid.nullable().default(null),
  test: z.boolean().default(false),
  channels: channelsSchema,
});
export type ProposedPostInput = z.infer<typeof proposedPostInputSchema>;

/** The path parameter of a read and of every decision. */
export const proposedPostIdSchema = z.object({ id: uuid });

/** `POST .../:id/approve`: the revision the person saw; a newer one answers 409 `stale` (the SQL raises `version_conflict`; `fromRpcError` renames it). */
export const proposedPostApproveSchema = proposedPostIdSchema.extend({
  revision: z.number().int().min(1),
});

/** `POST .../:id/reject` and `.../:id/rerender`: the note says what should change. */
export const proposedPostNoteSchema = proposedPostIdSchema.extend({
  note: z.string().trim().min(1).max(1000),
});

/** `POST .../:id/revise`: a rejected post's next revision. */
export const proposedPostReviseSchema = proposedPostIdSchema.extend({
  title: title.optional(),
  channels: channelsSchema,
});
export type ProposedPostRevise = z.infer<typeof proposedPostReviseSchema>;

/** `GET /api/admin/proposed-posts`: one keyset page (invariant 17c), optionally of one status. */
export const proposedPostFilters = adminPageSchema.extend({
  status: z.enum(proposedPostStatuses).optional(),
});
export type ProposedPostFilters = z.infer<typeof proposedPostFilters>;

const adminFileSchema = postFileSchema.extend({ url: z.string() });

const adminPostChannelSchema = z.object({
  channel: z.enum(proposedChannels),
  format: z.enum(postFormats),
  caption: z.string(),
  images: z.array(adminFileSchema),
  reel: z.object({ video: adminFileSchema, poster: adminFileSchema.nullable() }).nullable(),
  asset_id: uuid.nullable(),
  social_post_id: uuid.nullable(),
});

export const adminProposedPostSchema = z.object({
  id: uuid,
  title: z.string(),
  property_id: uuid.nullable(),
  submission_id: uuid.nullable(),
  proposer_kind: z.enum(["human", "agent"]),
  proposer_agent: z.string().nullable(),
  proposer_user: uuid.nullable(),
  test: z.boolean(),
  status: z.enum(proposedPostStatuses),
  revision: z.number().int(),
  rejection_note: z.string().nullable(),
  approved_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  channels: z.array(adminPostChannelSchema),
});
export type AdminProposedPost = z.infer<typeof adminProposedPostSchema>;

export const proposedPostListSchema = adminPageAnswer(adminProposedPostSchema);

export const postRevisionSchema = z.object({
  revision: z.number().int(),
  reason: z.enum(["rejected", "rerender"]),
  note: z.string(),
  asked_by: uuid.nullable(),
  asked_by_kind: z.enum(["human", "agent"]),
  snapshot: z.record(z.string(), z.unknown()),
  created_at: z.string(),
});

export const proposedPostDetailSchema = adminProposedPostSchema.extend({
  revisions: z.array(postRevisionSchema),
});

/** What a decision answers: the post and, for an approval, the events planned and the rows the posting path reads. */
export const proposedPostDecisionSchema = z.object({
  post_id: uuid,
  revision: z.number().int(),
  event_ids: z.array(uuid).default([]),
  social_post_ids: z.array(uuid).default([]),
});
export type ProposedPostDecision = z.infer<typeof proposedPostDecisionSchema>;
