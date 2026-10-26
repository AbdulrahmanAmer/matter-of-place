import type { AdminProposedPost, ProposedPostStatus } from "../../domain/proposed-posts";

// The words the Proposed posts screen uses for what item 10's routes answer (`src/domain/proposed-posts.ts`).

/** One channel of a post as the admin route answers it: its files carry the address the browser loads them from. */
export type PostChannel = AdminProposedPost["channels"][number];

/** One file of a post as the admin route answers it: the storage key, where it came from and its address. */
export type PostFileView = PostChannel["images"][number];

export const proposedChannelLabels: Record<PostChannel["channel"], string> = {
  instagram: "Instagram",
  x: "X",
  linkedin: "LinkedIn",
};

export const proposedFormatLabels: Record<PostChannel["format"], string> = {
  carousel: "Carousel",
  single: "Single post",
  reel: "Reel",
};

export const proposedStatusLabels: Record<ProposedPostStatus, string> = {
  proposed: "Proposed",
  rejected: "Rejected",
  approved: "Approved",
  scheduled: "Scheduled",
  posted: "Posted",
};

/** The action ids of item 10's routes (`src/server/lib/permissions/proposed-posts.ts`): a button shows only for an actor who holds its action. */
export const proposedActions = {
  approve: "channels.proposed_approve",
  reject: "channels.proposed_reject",
  rerender: "channels.proposed_rerender",
} as const;

/** Who proposed a post: an agent by its slug, a person as "a person" (the route names the account, not the name). */
export function proposerOf(
  post: Pick<AdminProposedPost, "proposer_kind" | "proposer_agent">,
): string {
  if (post.proposer_kind === "human") return "a person";
  return post.proposer_agent ?? "a colleague";
}
