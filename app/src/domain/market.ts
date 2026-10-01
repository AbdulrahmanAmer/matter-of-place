/**
 * Markets and regions.
 *
 * A market is a state-level territory (California, Florida, New York). Each
 * market is divided into regions (Bay Area, Miami, Manhattan) that own a page,
 * a filtered collection and a short piece of local knowledge.
 */
export type MarketSlug = "california" | "florida" | "new-york";

export type RegionSlug =
  | "bay-area"
  | "los-angeles"
  | "orange-county"
  | "la-jolla"
  | "miami"
  | "palm-beach"
  | "naples"
  | "fort-lauderdale"
  | "manhattan"
  | "brooklyn"
  | "the-hamptons"
  | "hudson-valley";

export type Region = {
  slug: RegionSlug;
  name: string;
  intro: string;
  /** Neighbourhoods and towns the region covers, in display order. */
  places: string[];
  /** Editorial hero photograph for the region page. */
  image: string;
};

/** A labelled paragraph of local knowledge. */
export type Note = {
  label: string;
  text: string;
};

export type Neighborhood = {
  name: string;
  region: RegionSlug;
  text: string;
};

/** Market guide: neighbourhoods, what clients ask of us, how we work on the ground. */
export type MarketGuide = {
  neighborhoods: Neighborhood[];
  needs: Note[];
  service: Note[];
};

export type Market = {
  slug: MarketSlug;
  name: string;
  country: string;
  /** ISO 4217 currency used for asking prices in this market. */
  currency: string;
  intro: string;
  /** Places the market follows, shown on the market page. */
  places: string[];
  regions: Region[];
  /** "How we read this market": what shapes its architecture. */
  notes: Note[];
  guide: MarketGuide;
  /** Editorial hero photograph for the market. */
  image: string;
};
