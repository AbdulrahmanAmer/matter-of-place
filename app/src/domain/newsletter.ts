import { z } from "zod";

// Place Notes, the fortnightly issue (B11). `newsletter_issues.blocks` is jsonb, so this schema is its only guard
// besides the `jsonb_typeof(blocks) = 'array'` check: the block shape here and the writers of the column change
// together (G-004). This file is loaded by the Deno job runner, so imports carry `.ts`.

/** The check constraint of `newsletter_issues.status`. */
export const issueStatuses = ["draft", "approved", "sending", "sent"] as const;

const blockId = z.string().min(1);
const words = z.string().min(1).max(300);

/**
 * One block of an issue, in reading order. A property or story block carries the `title` and `deck` the subject and
 * preheader are built from, taken from the approved `newsletter_block` asset or the story when the block was added;
 * `text` is the line a human writes above it.
 */
const newsletterBlockSchema = z.discriminatedUnion("type", [
  z.object({ id: blockId, type: z.literal("intro"), text: z.string().min(1).max(2000) }),
  z.object({
    id: blockId,
    type: z.literal("property"),
    property_id: z.string().uuid(),
    asset_id: z.string().uuid(),
    title: words,
    deck: z.string().max(300),
    text: z.string().max(2000).optional(),
  }),
  z.object({
    id: blockId,
    type: z.literal("story"),
    story_id: z.string().uuid(),
    title: words,
    deck: z.string().max(300),
    text: z.string().max(2000).optional(),
  }),
]);

export const newsletterBlocksSchema = z.array(newsletterBlockSchema);

export type NewsletterBlock = z.infer<typeof newsletterBlockSchema>;
