// Payloads of the two public RPCs, as `public_state()` and `public_catalog_snapshot()` return them, for unit tests that
// run a catalog read against `fakeDb`. The shapes are the mapper's contract, so a change there fails here.
import type { Json } from "../../src/db";
import { fakeDb } from "./fake-db";

export function stateJson(version = 7, extra: Record<string, Json> = {}): Json {
  return {
    catalog_version: version,
    flags: {},
    coming_soon_global: false,
    coming_soon_markets: { california: false },
    site: null,
    illustrative_content: false,
    ...extra,
  };
}

export function propertyJson(slug = "p1"): Json {
  return {
    id: `00000000-0000-4000-8000-${slug.padStart(12, "0")}`,
    slug,
    title: "Cliff House",
    market_slug: "california",
    region_slug: "bay-area",
    city: "Tiburon",
    neighborhood: "Belvedere",
    state: "California",
    country: "United States",
    address: "1 Cliff Road",
    coordinates: [-122.45, 37.87],
    price: 4_500_000,
    currency: "USD",
    beds: 4,
    baths: 3,
    interior_sq_ft: 3200,
    lot_acres: 0.4,
    year_built: 1962,
    type: "Residence",
    style: "Modernist",
    architect: null,
    designer: null,
    status: "Active",
    hero_image: `o/${slug}/0-ab12cd34.webp`,
    video: null,
    og_image_key: null,
    story: ["One paragraph."],
    place: "A quiet hill.",
    representative_id: null,
    presented_by_owner: false,
    listing_url: null,
    hero_rank: null,
    featured_rank: null,
    published_at: "2026-08-14T00:00:00+00:00",
    updated_at: "2026-08-14T00:00:00+00:00",
    media: [
      {
        id: "m1",
        media_key: `o/${slug}/0-ab12cd34.webp`,
        variants: {},
        alt: "Front",
        orientation: "landscape",
        sort_order: 0,
      },
    ],
    features: ["Pool"],
    related: [],
  };
}

export function snapshotJson(version = 7, parts: Record<string, Json> = {}): Json {
  return {
    catalog_version: version,
    markets: [],
    regions: [],
    market_notes: [],
    market_guide_entries: [],
    representatives: [],
    properties: [propertyJson()],
    stories: [],
    redirects: [],
    slug_history: [],
    gone: [],
    ...parts,
  };
}

/** A client that serves one catalog version and records every call. */
export function catalogDb(version = 7, parts: Record<string, Json> = {}) {
  return fakeDb({
    rpc: {
      public_state: () => stateJson(version),
      public_catalog_snapshot: () => snapshotJson(version, parts),
      rate_limit_check: () => [{ allowed: true, retry_after: 0 }],
    },
  });
}
