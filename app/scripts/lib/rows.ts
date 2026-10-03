// The seed's mapping from the camelCase domain objects of `src/data` to snake_case rows (B2 Data changes item 4).
// Pure: the key of a stored photograph comes from `keyOf`, so no file is read here.
import { createHash } from "node:crypto";
import type { TablesInsert } from "../../src/db/index.ts";
import type { Market } from "../../src/domain/market.ts";
import type { Property } from "../../src/domain/property.ts";
import type { Story } from "../../src/domain/story.ts";

/** The key a source image has in the `media` bucket: `o/<owner>/<n>-<sha8>.webp`. */
export type KeyOf = (source: string, owner: string, n: number) => string;

interface MarketRows {
  market: TablesInsert<"markets">;
  regions: TablesInsert<"regions">[];
  notes: TablesInsert<"market_notes">[];
  guide: TablesInsert<"market_guide_entries">[];
}

/** `numeric(12,2)` travels as a string with two decimals, so no float rounds a price. */
type PropertyInsert = Omit<TablesInsert<"properties">, "price"> & { price: string };

interface PropertyRows {
  representative: TablesInsert<"representatives"> | null;
  property: PropertyInsert;
  media: TablesInsert<"property_media">[];
  features: TablesInsert<"property_features">[];
  related: TablesInsert<"property_related">[];
}

/**
 * A uuid derived from its parts, so a rerun upserts the same row instead of adding a second one. Rows that have no
 * natural key (notes, guide entries, photographs, representatives) get theirs from here.
 */
export function stableId(...parts: string[]): string {
  const hex = createHash("sha256").update(parts.join("\u0000")).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(12, 15)}-a${hex.slice(15, 18)}-${hex.slice(18, 30)}`;
}

/** A catalog image column holds the key of the stripped master; `image_variants` stays `{}` until it is rendered. */
export function marketToRows(market: Market, keyOf: KeyOf, order: number): MarketRows {
  return {
    market: {
      slug: market.slug,
      name: market.name,
      country: market.country,
      currency: market.currency,
      intro: market.intro,
      places: market.places,
      image: keyOf(market.image, market.slug, 0),
      image_variants: {},
      sort_order: order,
    },
    regions: market.regions.map((region, index) => ({
      slug: region.slug,
      market_slug: market.slug,
      name: region.name,
      intro: region.intro,
      places: region.places,
      image: keyOf(region.image, region.slug, 0),
      image_variants: {},
      sort_order: index,
    })),
    notes: market.notes.map((note, index) => ({
      id: stableId("market_note", market.slug, String(index)),
      market_slug: market.slug,
      label: note.label,
      text: note.text,
      sort_order: index,
    })),
    guide: [
      ...market.guide.neighborhoods.map((entry) => ({
        section: "neighborhood",
        label: entry.name,
        text: entry.text,
        region_slug: entry.region,
      })),
      ...market.guide.needs.map((entry) => ({
        section: "need",
        label: entry.label,
        text: entry.text,
      })),
      ...market.guide.service.map((entry) => ({
        section: "service",
        label: entry.label,
        text: entry.text,
      })),
    ].map((entry, index) => ({
      id: stableId("market_guide_entry", market.slug, String(index)),
      market_slug: market.slug,
      sort_order: index,
      ...entry,
    })),
  };
}

/** `point(longitude, latitude)` in Postgres text form; the domain tuple is `[latitude, longitude]`. */
function toPoint(coordinates: Property["coordinates"]): string | null {
  return coordinates === undefined ? null : `(${String(coordinates[1])},${String(coordinates[0])})`;
}

function representativeRow(
  representation: Property["representation"],
  keyOf: KeyOf,
): TablesInsert<"representatives"> | null {
  if (representation === undefined) return null;
  const id = stableId("representative", representation.name, representation.brokerage);
  return {
    id,
    name: representation.name,
    brokerage: representation.brokerage,
    license: representation.license ?? null,
    email: representation.email ?? null,
    phone: representation.phone ?? null,
    photo: representation.photo === undefined ? null : keyOf(representation.photo, id, 0),
  };
}

/**
 * The hero is the first photograph (`sort_order` 0) and the gallery follows; the seed never writes
 * `properties.hero_image`, the trigger `property_media_hero_image` derives it from the first row (G66). Editorial state
 * and publication date are not here either: a property is made public by the seed's own two updates, after its media.
 */
export function propertyToRows(property: Property, keyOf: KeyOf): PropertyRows {
  const slug = property.slug;
  const id = stableId("property", slug);
  const representative = representativeRow(property.representation, keyOf);
  const photographs = [
    { src: property.heroImage, alt: property.title, orientation: "landscape" as const },
    ...property.gallery,
  ];
  const poster =
    property.video === undefined ? null : keyOf(property.video.poster, slug, photographs.length);
  return {
    representative,
    property: {
      id,
      slug,
      title: property.title,
      market_slug: property.market,
      region_slug: property.region,
      city: property.city,
      neighborhood: property.neighborhood,
      state: property.state,
      country: property.country,
      address: property.address,
      coordinates: toPoint(property.coordinates),
      price: property.price.toFixed(2),
      currency: property.currency,
      beds: property.beds,
      baths: property.baths,
      interior_sq_ft: property.interiorSqFt,
      lot_acres: property.lotAcres,
      year_built: property.yearBuilt,
      type: property.type,
      style: property.style,
      architect: property.architect ?? null,
      designer: property.designer ?? null,
      status: property.status,
      video:
        property.video === undefined || poster === null
          ? null
          : {
              src: property.video.src.replace(/^\/media\//, ""),
              poster,
              caption: property.video.caption,
              duration: property.video.duration,
            },
      story: property.story,
      place: property.place,
      representative_id: representative?.id ?? null,
      listing_url: property.listingUrl ?? null,
      hero_rank: property.heroRank ?? null,
      featured_rank: property.featuredRank ?? null,
      campaign_tier: property.campaignTier,
      source: property.source,
    },
    media: photographs.map((photograph, index) => ({
      id: stableId("property_media", slug, String(index)),
      property_id: id,
      media_key: keyOf(photograph.src, slug, index),
      variants: {},
      alt: photograph.alt,
      orientation: photograph.orientation,
      sort_order: index,
    })),
    features: property.features.map((feature, index) => ({
      property_id: id,
      feature,
      sort_order: index,
    })),
    related: (property.related ?? []).map((relatedSlug, index) => ({
      property_id: id,
      related_slug: relatedSlug,
      sort_order: index,
    })),
  };
}

/** The domain's ISO date as the instant a row is published: midnight UTC. */
export function publicationTime(date: string): string {
  return `${date}T00:00:00Z`;
}

/** A story is published when it is written: it has no media gate. */
export function storyToRow(story: Story, keyOf: KeyOf): TablesInsert<"stories"> {
  return {
    slug: story.slug,
    title: story.title,
    deck: story.deck,
    category: story.category,
    market_slug: story.market,
    image: keyOf(story.image, story.slug, 0),
    image_variants: {},
    body: story.body,
    properties: story.properties,
    editorial_state: "published",
    published_at: publicationTime(story.publishedAt),
  };
}
