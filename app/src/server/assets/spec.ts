import { z } from "zod";
import type { Tables } from "../../db/index.ts";
import { NonRetryableError } from "../jobs/types.ts";
import { sha256Hex } from "../lib/crypto.ts";
import type { Db } from "../lib/db.ts";
import { AppError } from "../lib/errors.ts";
import { mediaUrl } from "../lib/media-store.ts";
import type { SlideSpec } from "../../templates/social/slides.ts";

// What a render script reads (B9 Contract): the property facts and its photographs as absolute URLs, built from rows
// only, so the same rows give the same spec and the same hash. Plain `type` aliases, so a spec is a `Json` value.

export type SpecKind = "cover" | "carousel" | "story";
export type Variant = "thumb" | "card" | "hero" | "og" | "carousel";

export type RenderSpec = {
  kind: SpecKind;
  property: {
    id: string;
    slug: string;
    title: string;
    city: string;
    state: string;
    market: string;
    price: number;
    currency: string;
    beds: number;
    baths: number;
    interiorSqFt: number;
    yearBuilt: number;
    type: string;
    place: string;
  };
  images: {
    url: string;
    alt: string;
    orientation: "landscape" | "portrait";
    w: number;
    h: number;
  }[];
  slides?: SlideSpec[];
  out: { key_prefix: string };
};

export type SpecPropertyRow = Pick<
  Tables<"properties">,
  | "id"
  | "slug"
  | "title"
  | "city"
  | "state"
  | "market_slug"
  | "price"
  | "currency"
  | "beds"
  | "baths"
  | "interior_sq_ft"
  | "year_built"
  | "type"
  | "place"
  | "campaign_tier"
  | "editorial_state"
>;

export type SpecMediaRow = Pick<
  Tables<"property_media">,
  "id" | "media_key" | "variants" | "alt" | "orientation" | "sort_order" | "staging_path"
>;

// The five sizes of B2's `MediaVariants`, each `{ w, h }` and nothing else (P-335).
const sizeSchema = z.object({ w: z.number().int().positive(), h: z.number().int().positive() });
const sizesSchema = z.object({
  thumb: sizeSchema.optional(),
  card: sizeSchema.optional(),
  hero: sizeSchema.optional(),
  og: sizeSchema.optional(),
  carousel: sizeSchema.optional(),
});

// A cover is the Open Graph size; the carousel and the story crop the 1080x1350 size.
const VARIANT_OF_KIND: Record<SpecKind, Variant> = {
  cover: "og",
  carousel: "carousel",
  story: "carousel",
};
const EXTENSION: Record<Variant, "webp" | "jpg"> = {
  thumb: "webp",
  card: "webp",
  hero: "webp",
  og: "jpg",
  carousel: "jpg",
};
// `o/<owner>/<n>-<sha8>.webp` is the stored master; every size derives from it as `v/<owner>/<n>-<sha8>/<size>.<ext>`
// (`variantKeys` in scripts/variants.ts, GOTCHAS P-335). Scripts cannot be imported here: the Deno runner loads this file.
const MASTER_KEY = /^o\/([^/]+)\/(\d+-[0-9a-f]{8})\.webp$/;

function unavailable(table: string): AppError {
  return new AppError("unavailable", undefined, `The ${table} read did not answer.`);
}

export function variantKey(master: string, variant: Variant): string {
  const parts = MASTER_KEY.exec(master);
  if (parts === null) throw new NonRetryableError("media_key_unexpected");
  return `v/${parts[1] ?? ""}/${parts[2] ?? ""}/${variant}.${EXTENSION[variant]}`;
}

/** The property row a render reads; null when there is none. */
export async function loadProperty(db: Db, propertyId: string): Promise<SpecPropertyRow | null> {
  const { data, error } = await db
    .from("properties")
    .select(
      "id, slug, title, city, state, market_slug, price, currency, beds, baths, interior_sq_ft, year_built, type, place, campaign_tier, editorial_state",
    )
    .eq("id", propertyId);
  if (error !== null) throw unavailable("properties");
  return data[0] ?? null;
}

/** Every photograph of the property in gallery order, hero first. */
export async function loadMedia(db: Db, propertyId: string): Promise<SpecMediaRow[]> {
  const { data, error } = await db
    .from("property_media")
    .select("id, media_key, variants, alt, orientation, sort_order, staging_path")
    .eq("property_id", propertyId);
  if (error !== null) throw unavailable("property_media");
  return [...data].sort((a, b) => a.sort_order - b.sort_order);
}

/**
 * Invariant 10: true once every photograph of the property has `variant` rendered. A property with no photograph is
 * never ready, so a render never draws an empty card.
 */
export async function variantsReady(
  db: Db,
  propertyId: string,
  variant: Variant,
): Promise<boolean> {
  const media = await loadMedia(db, propertyId);
  return (
    media.length > 0 &&
    media.every((row) => sizesSchema.safeParse(row.variants).data?.[variant] !== undefined)
  );
}

/**
 * The spec of one render. The nullable columns of a draft are never null on a published row (B2's publish gate), so a
 * null here is a row that bypassed it: the render stops with `publish_incomplete` instead of drawing an empty slot (G62).
 */
export function buildRenderSpec(
  property: SpecPropertyRow,
  media: readonly SpecMediaRow[],
  kind: SpecKind,
  revision: number,
): RenderSpec {
  const { price, beds, baths, interior_sq_ft: interiorSqFt, year_built: yearBuilt } = property;
  if (
    price === null ||
    beds === null ||
    baths === null ||
    interiorSqFt === null ||
    yearBuilt === null
  ) {
    throw new NonRetryableError("publish_incomplete");
  }
  const variant = VARIANT_OF_KIND[kind];
  const images = media.flatMap((row) => {
    const size = sizesSchema.safeParse(row.variants).data?.[variant];
    if (row.media_key === null || size === undefined) return [];
    return [
      {
        url: mediaUrl(variantKey(row.media_key, variant), { absolute: true }),
        alt: row.alt ?? "",
        orientation: row.orientation ?? "landscape",
        w: size.w,
        h: size.h,
      },
    ];
  });
  return {
    kind,
    property: {
      id: property.id,
      slug: property.slug,
      title: property.title,
      city: property.city,
      state: property.state,
      market: property.market_slug,
      price,
      currency: property.currency,
      beds,
      baths,
      interiorSqFt,
      yearBuilt,
      type: property.type,
      place: property.place ?? "",
    },
    images,
    out: { key_prefix: `assets/${property.id}/${kind}/r${String(revision)}/` },
  };
}

/** The SHA-256 of the spec as JSON; the keys are written in one fixed order, so the same rows hash the same. */
export function specHash(spec: RenderSpec): Promise<string> {
  return sha256Hex(JSON.stringify(spec));
}
