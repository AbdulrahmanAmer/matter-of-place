import { z } from "zod";
import { marketSlugSchema } from "./market.ts";

/**
 * Editorial story. Original writing that does not depend on a submission:
 * architecture, interiors and places across the three market desks.
 */
export const storySchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  /** One-sentence standfirst shown under the title and on cards. */
  deck: z.string(),
  category: z.enum(["Architecture", "Interiors", "Places", "Stories"]),
  market: marketSlugSchema,
  image: z.string(),
  /** Body, one paragraph per entry. */
  body: z.array(z.string()),
  /** Property slugs the story mentions, shown beneath it. */
  properties: z.array(z.string()),
  /** ISO date. */
  publishedAt: z.string(),
});
export type Story = z.infer<typeof storySchema>;
