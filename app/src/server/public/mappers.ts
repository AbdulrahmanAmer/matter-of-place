import { z } from "zod";
import { marketSlugSchema, regionSlugSchema, type Market } from "../../domain/market.ts";
import {
  propertySchema,
  type GalleryImage,
  type ImageVariants,
  type Property,
  type PropertyCard,
} from "../../domain/property.ts";
import { storySchema, type Story } from "../../domain/story.ts";
import { pickCard } from "../../lib/property-card.ts";
import { mediaUrl } from "../lib/media-store.ts";
import type { PublicState } from "./state.ts";

// The mappers turn the snake_case snapshot of `public_catalog_snapshot()` into the camelCase domain
// types, once per catalog version (invariant 15). They take no request input: a cached body never
// varies by visitor. The job runner loads this file, so it imports only what Deno can resolve (G39).

const sizeSchema = z.object({ w: z.number(), h: z.number() });
// `{}` until a photograph is rendered, then all five sizes (G59).
const sizesSchema = z
  .object({
    thumb: sizeSchema,
    card: sizeSchema,
    hero: sizeSchema,
    og: sizeSchema,
    carousel: sizeSchema,
  })
  .partial();

const mediaRowSchema = z.object({
  media_key: z.string(),
  variants: sizesSchema,
  alt: z.string().nullable(),
  orientation: z.enum(["landscape", "portrait"]).nullable(),
  sort_order: z.number(),
});

const videoRowSchema = z.object({
  src: z.string(),
  poster: z.string(),
  caption: z.string(),
  duration: z.string(),
});

const representativeRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  brokerage: z.string(),
  license: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  photo: z.string().nullable(),
});

// A published row is complete (`enforce_publish_gate`), so the fields the gate checks are not nullable here.
const propertyRowSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  market_slug: marketSlugSchema,
  region_slug: regionSlugSchema,
  city: z.string(),
  neighborhood: z.string(),
  state: z.string(),
  country: z.string(),
  address: z.string(),
  coordinates: z.tuple([z.number(), z.number()]).nullable(),
  price: z.number(),
  currency: z.string(),
  beds: z.number(),
  baths: z.number(),
  interior_sq_ft: z.number(),
  lot_acres: z.number(),
  year_built: z.number(),
  type: propertySchema.shape.type,
  style: z.string(),
  architect: z.string().nullable(),
  designer: z.string().nullable(),
  status: propertySchema.shape.status,
  hero_image: z.string(),
  video: videoRowSchema.nullable(),
  og_image_key: z.string().nullable(),
  story: z.array(z.string()),
  place: z.string(),
  representative_id: z.string().nullable(),
  presented_by_owner: z.boolean().default(false),
  listing_url: z.string().nullable(),
  hero_rank: z.number().nullable(),
  featured_rank: z.number().nullable(),
  published_at: z.string(),
  media: z.array(mediaRowSchema),
  features: z.array(z.string()),
  related: z.array(z.string()),
});
export type PropertyRow = z.infer<typeof propertyRowSchema>;
export type RepresentativeRow = z.infer<typeof representativeRowSchema>;

const marketRowSchema = z.object({
  slug: marketSlugSchema,
  name: z.string(),
  country: z.string(),
  currency: z.string(),
  intro: z.string(),
  places: z.array(z.string()),
  image: z.string().nullable(),
  interest_copy: z.string().nullable(),
});

const regionRowSchema = z.object({
  slug: regionSlugSchema,
  market_slug: marketSlugSchema,
  name: z.string(),
  intro: z.string(),
  places: z.array(z.string()),
  image: z.string().nullable(),
});

const noteRowSchema = z.object({
  market_slug: marketSlugSchema,
  label: z.string(),
  text: z.string(),
});

const guideRowSchema = z.object({
  market_slug: marketSlugSchema,
  section: z.enum(["neighborhood", "need", "service"]),
  region_slug: regionSlugSchema.nullable(),
  label: z.string(),
  text: z.string(),
});

const storyRowSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  deck: z.string(),
  category: storySchema.shape.category,
  market_slug: marketSlugSchema,
  image: z.string().nullable(),
  body: z.array(z.string()),
  properties: z.array(z.string()),
  published_at: z.string(),
});

const redirectRowSchema = z.object({
  from_path: z.string(),
  to_path: z.string(),
  status: z.number(),
});

/** What `public_catalog_snapshot()` returns, parsed. A row that breaks the shape fails the whole read, so a bad row is never served. */
const snapshotSchema = z.object({
  catalog_version: z.number(),
  markets: z.array(marketRowSchema),
  regions: z.array(regionRowSchema),
  market_notes: z.array(noteRowSchema),
  market_guide_entries: z.array(guideRowSchema),
  representatives: z.array(representativeRowSchema),
  properties: z.array(propertyRowSchema),
  stories: z.array(storyRowSchema),
  redirects: z.array(redirectRowSchema),
  slug_history: z.array(z.object({ slug: z.string(), property_id: z.string() })),
  gone: z.array(z.string()),
});

export type Snapshot = z.infer<typeof snapshotSchema>;
type MarketRow = z.infer<typeof marketRowSchema>;
type RegionRow = z.infer<typeof regionRowSchema>;
type NoteRow = z.infer<typeof noteRowSchema>;
type GuideRow = z.infer<typeof guideRowSchema>;
type StoryRow = z.infer<typeof storyRowSchema>;
type MediaRow = z.infer<typeof mediaRowSchema>;
type Sizes = z.infer<typeof sizesSchema>;

export function parseSnapshot(json: unknown): Snapshot {
  return snapshotSchema.parse(json);
}

/** The mapped, visible rows of one catalog version: what `applyVisibility` filters (B3b). */
export interface CatalogRows {
  properties: Property[];
  markets: Market[];
  stories: Story[];
}

export type Catalog = CatalogRows & {
  version: number;
  redirects: Snapshot["redirects"];
  slugHistory: Snapshot["slug_history"];
};

// `o/<owner>/<n>-<sha8>.webp` is the stored master of a photograph; every rendition's key is derived
// from it as `v/<owner>/<n>-<sha8>/<size>.<ext>` (`variantKeys` in scripts/variants.ts, GOTCHAS P-335).
const MASTER_KEY = /^o\/([^/]+)\/(\d+-[0-9a-f]{8})\.webp$/;

function renditionKey(master: string, size: "card" | "hero" | "og"): string | undefined {
  const parts = MASTER_KEY.exec(master);
  return parts === null
    ? undefined
    : `v/${parts[1] ?? ""}/${parts[2] ?? ""}/${size}.${size === "og" ? "jpg" : "webp"}`;
}

/** The sizes a page reads (`card`, `hero`) and the Open Graph size, as addresses; undefined until the photograph is rendered. */
function toImageVariants(master: string, sizes: Sizes): ImageVariants | undefined {
  const card = sizes.card === undefined ? undefined : renditionKey(master, "card");
  const hero = sizes.hero === undefined ? undefined : renditionKey(master, "hero");
  const og = sizes.og === undefined ? undefined : renditionKey(master, "og");
  const variants: ImageVariants = {
    ...(card !== undefined &&
      sizes.card !== undefined && { card: { webp: mediaUrl(card), ...sizes.card } }),
    ...(hero !== undefined &&
      sizes.hero !== undefined && { hero: { webp: mediaUrl(hero), ...sizes.hero } }),
    ...(og !== undefined &&
      sizes.og !== undefined && { og: { jpg: mediaUrl(og, { absolute: true }), ...sizes.og } }),
  };
  return Object.keys(variants).length === 0 ? undefined : variants;
}

function toGalleryImage(media: MediaRow): GalleryImage {
  const variants = toImageVariants(media.media_key, media.variants);
  return {
    src: mediaUrl(media.media_key),
    alt: media.alt ?? "",
    orientation: media.orientation ?? "landscape",
    ...(variants !== undefined && { variants }),
  };
}

function toRepresentation(
  representative: RepresentativeRow,
): NonNullable<Property["representation"]> {
  return {
    name: representative.name,
    brokerage: representative.brokerage,
    ...(representative.license !== null && { license: representative.license }),
    ...(representative.email !== null && { email: representative.email }),
    ...(representative.phone !== null && { phone: representative.phone }),
    ...(representative.photo !== null && { photo: mediaUrl(representative.photo) }),
  };
}

/** `[longitude, latitude]` in the snapshot, `[latitude, longitude]` in the domain. */
const toCoordinates = (point: [number, number] | null): Property["coordinates"] =>
  point === null ? undefined : [point[1], point[0]];

const isoDate = (timestamp: string): string => timestamp.slice(0, 10);

export function toProperty(row: PropertyRow, representative?: RepresentativeRow): Property {
  const media = [...row.media].sort((a, b) => a.sort_order - b.sort_order);
  const heroRow = media.find((entry) => entry.media_key === row.hero_image);
  const heroVariants =
    heroRow === undefined ? undefined : toImageVariants(heroRow.media_key, heroRow.variants);
  const coordinates = toCoordinates(row.coordinates);
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    market: row.market_slug,
    region: row.region_slug,
    city: row.city,
    neighborhood: row.neighborhood,
    state: row.state,
    country: row.country,
    address: row.address,
    ...(coordinates !== undefined && { coordinates }),
    price: row.price,
    currency: row.currency,
    beds: row.beds,
    baths: row.baths,
    interiorSqFt: row.interior_sq_ft,
    lotAcres: row.lot_acres,
    yearBuilt: row.year_built,
    type: row.type,
    style: row.style,
    ...(row.architect !== null && { architect: row.architect }),
    ...(row.designer !== null && { designer: row.designer }),
    status: row.status,
    heroImage: heroVariants?.hero?.webp ?? mediaUrl(row.hero_image),
    ...(heroVariants !== undefined && { heroVariants }),
    ...(row.og_image_key !== null && { ogImage: mediaUrl(row.og_image_key, { absolute: true }) }),
    gallery: media.filter((entry) => entry !== heroRow).map(toGalleryImage),
    ...(row.video !== null && {
      video: {
        src: mediaUrl(row.video.src),
        poster: mediaUrl(row.video.poster),
        caption: row.video.caption,
        duration: row.video.duration,
      },
    }),
    story: row.story,
    place: row.place,
    features: row.features,
    ...(representative !== undefined &&
      !row.presented_by_owner && { representation: toRepresentation(representative) }),
    presentedByOwner: row.presented_by_owner,
    ...(row.listing_url !== null && { listingUrl: row.listing_url }),
    ...(row.hero_rank !== null && { heroRank: row.hero_rank }),
    ...(row.featured_rank !== null && { featuredRank: row.featured_rank }),
    publishedAt: isoDate(row.published_at),
    ...(row.related.length > 0 && { related: row.related }),
  };
}

/** The list row of a property (PERF-06): the card fields only, the hero's `card` rendition, no gallery. */
export function toPropertyCard(property: Property): PropertyCard {
  return pickCard(property);
}

export function toStory(row: StoryRow): Story {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    deck: row.deck,
    category: row.category,
    market: row.market_slug,
    ...(row.image !== null && { image: mediaUrl(row.image) }),
    body: row.body,
    properties: row.properties,
    publishedAt: isoDate(row.published_at),
  };
}

interface MarketChildren {
  regions: RegionRow[];
  notes: NoteRow[];
  guide: GuideRow[];
}

export function toMarket(row: MarketRow, children: MarketChildren, comingSoon: boolean): Market {
  const entries = (section: GuideRow["section"]) =>
    children.guide.filter((entry) => entry.section === section);
  return {
    slug: row.slug,
    name: row.name,
    country: row.country,
    currency: row.currency,
    intro: row.intro,
    places: row.places,
    regions: children.regions.map((region) => ({
      slug: region.slug,
      name: region.name,
      intro: region.intro,
      places: region.places,
      ...(region.image !== null && { image: mediaUrl(region.image) }),
    })),
    notes: children.notes.map(({ label, text }) => ({ label, text })),
    guide: {
      neighborhoods: entries("neighborhood").flatMap((entry) =>
        entry.region_slug === null
          ? []
          : [{ name: entry.label, region: entry.region_slug, text: entry.text }],
      ),
      needs: entries("need").map(({ label, text }) => ({ label, text })),
      service: entries("service").map(({ label, text }) => ({ label, text })),
    },
    ...(row.image !== null && { image: mediaUrl(row.image) }),
    comingSoon,
    ...(row.interest_copy !== null && { interestCopy: row.interest_copy }),
  };
}

const groupBy = <T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> => {
  const groups = new Map<string, T[]>();
  for (const row of rows) groups.set(key(row), [...(groups.get(key(row)) ?? []), row]);
  return groups;
};

type ComingSoonState = Pick<PublicState, "comingSoonGlobal" | "comingSoonMarkets">;

/** The whole snapshot, mapped. `comingSoon` of a market comes from the public state, never from the market row (B2 invariant 16). */
export function mapSnapshot(snapshot: Snapshot, state: ComingSoonState): Catalog {
  const regions = groupBy(snapshot.regions, (row) => row.market_slug);
  const notes = groupBy(snapshot.market_notes, (row) => row.market_slug);
  const guide = groupBy(snapshot.market_guide_entries, (row) => row.market_slug);
  const representatives = new Map(snapshot.representatives.map((row) => [row.id, row]));
  return {
    version: snapshot.catalog_version,
    properties: snapshot.properties.map((row) =>
      toProperty(
        row,
        row.representative_id === null ? undefined : representatives.get(row.representative_id),
      ),
    ),
    markets: snapshot.markets.map((row) =>
      toMarket(
        row,
        {
          regions: regions.get(row.slug) ?? [],
          notes: notes.get(row.slug) ?? [],
          guide: guide.get(row.slug) ?? [],
        },
        state.comingSoonGlobal || (state.comingSoonMarkets[row.slug] ?? false),
      ),
    ),
    stories: snapshot.stories.map(toStory),
    redirects: snapshot.redirects,
    slugHistory: snapshot.slug_history,
  };
}
