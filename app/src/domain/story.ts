import type { MarketSlug } from "./market.ts";

/**
 * Editorial story. Original writing that does not depend on a submission:
 * architecture, interiors and places across the three market desks.
 */
const storyCategories = ["Architecture", "Interiors", "Places", "Stories"] as const;
type StoryCategory = (typeof storyCategories)[number];

export type Story = {
  id: string;
  slug: string;
  title: string;
  /** One-sentence standfirst shown under the title and on cards. */
  deck: string;
  category: StoryCategory;
  market: MarketSlug;
  image: string;
  /** Body, one paragraph per entry. */
  body: string[];
  /** Property slugs the story mentions, shown beneath it. */
  properties: string[];
  /** ISO date. */
  publishedAt: string;
};
