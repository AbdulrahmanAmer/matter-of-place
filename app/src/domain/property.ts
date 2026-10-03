import { z } from "zod";
import { marketSlugSchema, regionSlugSchema } from "./market.ts";

/**
 * Property (the "dossier"). Mirrors the `properties` table described in
 * docs/architecture/data-model.md; field names match the API contract so the
 * `http` catalog adapter needs no mapping layer.
 */
const representationSchema = z.object({
  name: z.string(),
  brokerage: z.string(),
  license: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  photo: z.string().optional(),
});

const renditionSchema = z.object({ w: z.number(), h: z.number() });

/**
 * The renditions a photograph has, as site addresses (`/media/<key>`; `og` absolute). They are WebP, except `og`,
 * which social channels need as JPEG (H33 (8)). `thumb` and `carousel` are never sent to a page.
 */
const imageVariantsSchema = z
  .object({
    card: renditionSchema.extend({ webp: z.string() }),
    hero: renditionSchema.extend({ webp: z.string() }),
    og: renditionSchema.extend({ jpg: z.string() }),
  })
  .partial();
export type ImageVariants = z.infer<typeof imageVariantsSchema>;

const galleryImageSchema = z.object({
  src: z.string(),
  alt: z.string(),
  orientation: z.enum(["landscape", "portrait"]),
  variants: imageVariantsSchema.optional(),
});
export type GalleryImage = z.infer<typeof galleryImageSchema>;

/** Optional film. `src` is a hosted MP4; `poster` is shown until the visitor presses play. */
const propertyVideoSchema = z.object({
  src: z.string(),
  poster: z.string(),
  caption: z.string(),
  /** Display duration, e.g. "0:06". */
  duration: z.string(),
});
export type PropertyVideo = z.infer<typeof propertyVideoSchema>;

export const propertySchema = z.object({
  id: z.string(),
  slug: z.string(),
  /** Editorial headline. */
  title: z.string(),
  market: marketSlugSchema,
  region: regionSlugSchema,
  city: z.string(),
  /** Neighbourhood or sub-area inside the region (e.g. Marin, Peninsula). */
  neighborhood: z.string(),
  /** State or province name, displayed after the city. */
  state: z.string(),
  country: z.string(),
  /** Display address. Exact addresses are withheld on illustrative content. */
  address: z.string(),
  coordinates: z.tuple([z.number(), z.number()]).optional(),
  price: z.number(),
  /** ISO 4217 currency code. */
  currency: z.string(),
  beds: z.number(),
  baths: z.number(),
  interiorSqFt: z.number(),
  lotAcres: z.number(),
  yearBuilt: z.number(),
  type: z.enum([
    "Estate",
    "Residence",
    "Townhouse",
    "Waterfront",
    "Farmhouse",
    "Apartment",
    "Penthouse",
  ]),
  /** Architectural style, free text (Contemporary, Shingle Style, Italianate). */
  style: z.string(),
  /** Credited architect and interior designer, when known. */
  architect: z.string().optional(),
  designer: z.string().optional(),
  status: z.enum(["Illustrative", "Active", "Off-market", "Under offer", "Sold"]),
  heroImage: z.string(),
  /** The hero photograph's renditions, once they are rendered. */
  heroVariants: imageVariantsSchema.optional(),
  /** Absolute address of the Open Graph image; unset until one is chosen. */
  ogImage: z.string().optional(),
  gallery: z.array(galleryImageSchema),
  video: propertyVideoSchema.optional(),
  /** Editorial narrative, one paragraph per entry. */
  story: z.array(z.string()),
  /** The place: one paragraph on the setting. */
  place: z.string(),
  features: z.array(z.string()),
  representation: representationSchema.optional(),
  /** The owner presents the home: no representative is named. */
  presentedByOwner: z.boolean(),
  listingUrl: z.string().optional(),
  /** Position in the home page opening sequence; unset means not shown there. */
  heroRank: z.number().optional(),
  /** Position in the home page "Selected places" grid; unset means not shown there. */
  featuredRank: z.number().optional(),
  /** Commercial and internal: the public snapshot does not carry it, so the API leaves it unset. */
  campaignTier: z.enum(["Editorial", "Feature", "Reach", "Campaign"]).optional(),
  /** ISO date the dossier was published. */
  publishedAt: z.string(),
  /** Internal like `campaignTier`: unset on the API. */
  source: z.enum(["Editorial", "Submission"]).optional(),
  /** Slugs of hand-picked related properties, shown before automatic matches. */
  related: z.array(z.string()).optional(),
});
export type Property = z.infer<typeof propertySchema>;
