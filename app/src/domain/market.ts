import { z } from "zod";

/**
 * Markets and regions.
 *
 * A market is a state-level territory (California, Florida, New York). Each
 * market is divided into regions (Bay Area, Miami, Manhattan) that own a page,
 * a filtered collection and a short piece of local knowledge.
 */
export const marketSlugSchema = z.enum(["california", "florida", "new-york"]);
export type MarketSlug = z.infer<typeof marketSlugSchema>;

export const regionSlugSchema = z.enum([
  "bay-area",
  "los-angeles",
  "orange-county",
  "la-jolla",
  "miami",
  "palm-beach",
  "naples",
  "fort-lauderdale",
  "manhattan",
  "brooklyn",
  "the-hamptons",
  "hudson-valley",
]);
export type RegionSlug = z.infer<typeof regionSlugSchema>;

const regionSchema = z.object({
  slug: regionSlugSchema,
  name: z.string(),
  intro: z.string(),
  /** Neighbourhoods and towns the region covers, in display order. */
  places: z.array(z.string()),
  /** Editorial hero photograph for the region page. */
  image: z.string(),
});

/** A labelled paragraph of local knowledge. */
const noteSchema = z.object({
  label: z.string(),
  text: z.string(),
});
export type Note = z.infer<typeof noteSchema>;

const neighborhoodSchema = z.object({
  name: z.string(),
  region: regionSlugSchema,
  text: z.string(),
});

/** Market guide: neighbourhoods, what clients ask of us, how we work on the ground. */
const marketGuideSchema = z.object({
  neighborhoods: z.array(neighborhoodSchema),
  needs: z.array(noteSchema),
  service: z.array(noteSchema),
});

export const marketSchema = z.object({
  slug: marketSlugSchema,
  name: z.string(),
  country: z.string(),
  /** ISO 4217 currency used for asking prices in this market. */
  currency: z.string(),
  intro: z.string(),
  /** Places the market follows, shown on the market page. */
  places: z.array(z.string()),
  regions: z.array(regionSchema),
  /** "How we read this market": what shapes its architecture. */
  notes: z.array(noteSchema),
  guide: marketGuideSchema,
  /** Editorial hero photograph for the market. */
  image: z.string(),
});
export type Market = z.infer<typeof marketSchema>;
