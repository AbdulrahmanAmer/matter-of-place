import type { MarketSlug, RegionSlug } from "./market.ts";

/**
 * Property (the "dossier"). Mirrors the `properties` table described in
 * docs/architecture/data-model.md; field names match the API contract so the
 * `http` catalog adapter needs no mapping layer.
 */
type CampaignTier = "Editorial" | "Feature" | "Reach" | "Campaign";

type ListingStatus = "Illustrative" | "Active" | "Off-market" | "Under offer" | "Sold";

type PropertyType =
  "Estate" | "Residence" | "Townhouse" | "Waterfront" | "Farmhouse" | "Apartment" | "Penthouse";

type SubmissionSource = "Editorial" | "Submission";

type Representation = {
  name: string;
  brokerage: string;
  license?: string;
  email?: string;
  phone?: string;
  photo?: string;
};

export type GalleryImage = {
  src: string;
  alt: string;
  orientation: "landscape" | "portrait";
};

/** Optional film. `src` is a hosted MP4; `poster` is shown until the visitor presses play. */
export type PropertyVideo = {
  src: string;
  poster: string;
  caption: string;
  /** Display duration, e.g. "0:06". */
  duration: string;
};

export type Property = {
  id: string;
  slug: string;
  /** Editorial headline. */
  title: string;
  market: MarketSlug;
  region: RegionSlug;
  city: string;
  /** Neighbourhood or sub-area inside the region (e.g. Marin, Peninsula). */
  neighborhood: string;
  /** State or province name, displayed after the city. */
  state: string;
  country: string;
  /** Display address. Exact addresses are withheld on illustrative content. */
  address: string;
  coordinates?: [latitude: number, longitude: number];
  price: number;
  /** ISO 4217 currency code. */
  currency: string;
  beds: number;
  baths: number;
  interiorSqFt: number;
  lotAcres: number;
  yearBuilt: number;
  type: PropertyType;
  /** Architectural style, free text (Contemporary, Shingle Style, Italianate). */
  style: string;
  /** Credited architect and interior designer, when known. */
  architect?: string;
  designer?: string;
  status: ListingStatus;
  heroImage: string;
  gallery: GalleryImage[];
  video?: PropertyVideo;
  /** Editorial narrative, one paragraph per entry. */
  story: string[];
  /** The place: one paragraph on the setting. */
  place: string;
  features: string[];
  representation?: Representation;
  listingUrl?: string;
  /** Position in the home page opening sequence; unset means not shown there. */
  heroRank?: number;
  /** Position in the home page "Selected places" grid; unset means not shown there. */
  featuredRank?: number;
  campaignTier: CampaignTier;
  /** ISO date the dossier was published. */
  publishedAt: string;
  source: SubmissionSource;
  /** Slugs of hand-picked related properties, shown before automatic matches. */
  related?: string[];
};
