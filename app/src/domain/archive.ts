import type { PropertyCard } from "./property.ts";

/** The three things an archive page can collect published properties by (architecture 13, step 4 of B13). */
export const archiveKinds = ["city", "architect", "style"] as const;
export type ArchiveKind = (typeof archiveKinds)[number];

export interface FacetSummary {
  kind: ArchiveKind;
  slug: string;
  label: string;
  count: number;
}

/** One archive page: the facet and its properties as list cards, never the full property (PERF-06). */
export interface Facet extends FacetSummary {
  items: PropertyCard[];
}

/** The facets that exist, by kind and then by label, with the slug of each; the property pages link only to these. */
export type FacetMap = Record<ArchiveKind, Record<string, string>>;
