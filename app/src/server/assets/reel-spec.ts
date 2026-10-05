import type { Enums, Tables } from "../../db/index.ts";
import type { MarketSlug } from "../../domain/market.ts";
import { NonRetryableError } from "../jobs/types.ts";

// What the reel scene reads (B12 Contract): the property facts, four photographs for the camera and six tiles for the
// grid, every string the scene draws and the sound design's bed and seed. Built from rows only and carrying no URL,
// so the same rows give the same spec and the same hash. Plain `type` aliases, so a spec is a `Json` value.

export type ReelBed = "wind" | "water" | "room" | "city";

export type ReelSpec = {
  kind: "reel";
  property: {
    title: string;
    city: string;
    state: string;
    market: string;
    price: number;
    currency: string;
    beds: number;
    baths: number;
    interiorSqFt: number;
    type: string;
  };
  shots: { key: string; alt: string; orientation: "landscape" | "portrait" }[];
  copy: {
    location: string;
    title: string;
    facts: string;
    price: string;
    site: string;
    credit: string;
  };
  sound: { bed: ReelBed; seed: number };
};

export type ReelPropertyRow = Pick<
  Tables<"properties">,
  | "id"
  | "title"
  | "city"
  | "state"
  | "market_slug"
  | "price"
  | "currency"
  | "beds"
  | "baths"
  | "interior_sq_ft"
  | "type"
>;

export type ReelMediaRow = Pick<
  Tables<"property_media">,
  "media_key" | "alt" | "orientation" | "sort_order"
>;

const CAMERA_SHOTS = 4;
const GRID_TILES = 6;

const SITE = "matterofplace.com";
const CREDIT = "A product of Omnikom";

const INDOORS: Record<MarketSlug, ReelBed> = {
  california: "room",
  florida: "room",
  "new-york": "city",
};
const OUTDOORS: Record<MarketSlug, ReelBed> = {
  california: "wind",
  florida: "wind",
  "new-york": "room",
};
const COAST: Record<MarketSlug, ReelBed> = {
  california: "water",
  florida: "water",
  "new-york": "water",
};

// ASSUMED, tunable here: the sound each kind of property gets, by market. The compiler refuses a missing type or market.
const BED_BY_TYPE: Record<Enums<"property_type">, Record<MarketSlug, ReelBed>> = {
  Waterfront: COAST,
  Apartment: INDOORS,
  Penthouse: INDOORS,
  Estate: OUTDOORS,
  Residence: OUTDOORS,
  Townhouse: OUTDOORS,
  Farmhouse: OUTDOORS,
};

function isMarket(value: string): value is MarketSlug {
  return Object.hasOwn(COAST, value);
}

export function bedFor(type: Enums<"property_type">, market: MarketSlug): ReelBed {
  return BED_BY_TYPE[type][market];
}

/** Every string the scene draws, in the voice of B9's `lintCaption`: no em dash, no exclamation, no merit word. */
export function reelCopy(property: ReelSpec["property"]): ReelSpec["copy"] {
  const number = (value: number) => value.toLocaleString("en-US");
  return {
    location: `${property.city}, ${property.state}`.toUpperCase(),
    title: property.title,
    facts: `${number(property.beds)} BED · ${number(property.baths)} BATH · ${number(property.interiorSqFt)} SF`,
    price: new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: property.currency,
      maximumFractionDigits: 0,
    }).format(property.price),
    site: SITE,
    credit: CREDIT,
  };
}

/**
 * The first four photographs in gallery order are the camera shots and the next six are the grid tiles; when fewer
 * than ten exist the tiles are filled with the camera shots in order. Fewer than four stop the step (invariant 9).
 */
export function buildReelSpec(property: ReelPropertyRow, media: readonly ReelMediaRow[]): ReelSpec {
  const { price, beds, baths, interior_sq_ft: interiorSqFt } = property;
  if (price === null || beds === null || baths === null || interiorSqFt === null) {
    throw new NonRetryableError("publish_incomplete");
  }
  if (!isMarket(property.market_slug)) throw new NonRetryableError("market_unknown");
  const seed = /^[0-9a-f]{8}/i.exec(property.id)?.[0];
  if (seed === undefined) throw new NonRetryableError("property_id_unexpected");

  const photos = [...media]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((row) => {
      if (row.media_key === null) throw new NonRetryableError("media_key_missing");
      return {
        key: row.media_key,
        alt: row.alt ?? "",
        orientation: row.orientation ?? "landscape",
      };
    });
  if (photos.length < CAMERA_SHOTS) throw new NonRetryableError("too_few_photos");

  const camera = photos.slice(0, CAMERA_SHOTS);
  const tiles = [...photos.slice(CAMERA_SHOTS), ...camera, ...camera].slice(0, GRID_TILES);
  const facts = {
    title: property.title,
    city: property.city,
    state: property.state,
    market: property.market_slug,
    price,
    currency: property.currency,
    beds,
    baths,
    interiorSqFt,
    type: property.type,
  };
  return {
    kind: "reel",
    property: facts,
    shots: [...camera, ...tiles],
    copy: reelCopy(facts),
    sound: { bed: bedFor(property.type, property.market_slug), seed: Number.parseInt(seed, 16) },
  };
}
