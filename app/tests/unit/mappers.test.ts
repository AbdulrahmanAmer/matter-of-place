import { afterEach, describe, expect, it, vi } from "vitest";
import {
  mapSnapshot,
  parseSnapshot,
  toMarket,
  toProperty,
  toPropertyCard,
  toStory,
  type PropertyRow,
  type RepresentativeRow,
} from "../../src/server/public/mappers";
import { variantKeys } from "../../scripts/variants";

const MASTER = "o/p1/1-ab12cd34.webp";
const SIZED = {
  thumb: { w: 320, h: 213 },
  card: { w: 720, h: 480 },
  hero: { w: 1600, h: 1067 },
  og: { w: 1200, h: 630 },
  carousel: { w: 1080, h: 1350 },
};

function row(overrides: Partial<PropertyRow> = {}): PropertyRow {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    slug: "p1",
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
    hero_image: MASTER,
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
    media: [
      { media_key: MASTER, variants: {}, alt: "Front", orientation: "landscape", sort_order: 0 },
    ],
    features: ["Pool"],
    related: [],
    ...overrides,
  };
}

const representative: RepresentativeRow = {
  id: "r1",
  name: "Ada Fixture",
  brokerage: "Fixture Brokerage",
  license: null,
  email: "ada@fixtures.invalid",
  phone: null,
  photo: "o/r1/0-0a0a0a0a.webp",
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("toProperty", () => {
  it("maps the video through mediaUrl on both keys, and no video when it is null", () => {
    const withVideo = toProperty(
      row({ video: { src: "v/a.mp4", poster: "v/a.jpg", caption: "c", duration: "0:18" } }),
    );
    expect(withVideo.video).toEqual({
      src: "/media/v/a.mp4",
      poster: "/media/v/a.jpg",
      caption: "c",
      duration: "0:18",
    });
    expect("video" in toProperty(row())).toBe(false);
  });

  it("gives an absolute ogImage from the public base, and none for a null key", () => {
    vi.stubEnv("MEDIA_PUBLIC_BASE", "https://m.test/media");
    expect(toProperty(row({ og_image_key: "o/p1/cover.jpg" })).ogImage).toBe(
      "https://m.test/media/o/p1/cover.jpg",
    );
    expect("ogImage" in toProperty(row())).toBe(false);
  });

  it("derives the hero and gallery variants from the master key and keeps the hero out of the gallery", () => {
    vi.stubEnv("MEDIA_PUBLIC_BASE", "https://m.test/media");
    const second = {
      media_key: "o/p1/2-0badc0de.webp",
      variants: SIZED,
      alt: "Terrace",
      orientation: "portrait" as const,
      sort_order: 1,
    };
    const property = toProperty(
      row({
        media: [
          {
            media_key: MASTER,
            variants: SIZED,
            alt: "Front",
            orientation: "landscape",
            sort_order: 0,
          },
          second,
        ],
      }),
    );
    const keys = variantKeys("p1", 1, "ab12cd34");
    expect(keys.master).toBe(MASTER);
    expect(property.heroImage).toBe(`/media/${keys.hero}`);
    expect(property.heroVariants).toEqual({
      card: { webp: `/media/${keys.card}`, w: 720, h: 480 },
      hero: { webp: `/media/${keys.hero}`, w: 1600, h: 1067 },
      og: { jpg: `https://m.test/media/${keys.og}`, w: 1200, h: 630 },
    });
    expect(property.gallery).toHaveLength(1);
    const next = variantKeys("p1", 2, "0badc0de");
    expect(property.gallery[0]).toEqual({
      src: `/media/${next.master}`,
      alt: "Terrace",
      orientation: "portrait",
      variants: {
        card: { webp: `/media/${next.card}`, w: 720, h: 480 },
        hero: { webp: `/media/${next.hero}`, w: 1600, h: 1067 },
        og: { jpg: `https://m.test/media/${next.og}`, w: 1200, h: 630 },
      },
    });
    expect(JSON.stringify(property)).not.toContain("supabase.co");
    expect(JSON.stringify(property.heroVariants)).not.toContain("thumb");
  });

  it("falls back to the master when the photograph is not rendered, with no variants", () => {
    const property = toProperty(row());
    expect(property.heroImage).toBe(`/media/${MASTER}`);
    expect("heroVariants" in property).toBe(false);
    expect(toProperty(row({ media: [] })).gallery).toEqual([]);
  });

  it("never lets a rendition of an unrecognised master become an address", () => {
    const property = toProperty(
      row({
        hero_image: "assets/hero.jpg",
        media: [
          {
            media_key: "assets/hero.jpg",
            variants: SIZED,
            alt: null,
            orientation: null,
            sort_order: 0,
          },
        ],
      }),
    );
    expect(property.heroImage).toBe("/media/assets/hero.jpg");
    expect("heroVariants" in property).toBe(false);
  });

  it("maps presented_by_owner, and shows no representative for an owner's home", () => {
    expect(toProperty(row(), representative).presentedByOwner).toBe(false);
    expect(toProperty(row(), representative).representation).toMatchObject({ name: "Ada Fixture" });
    const owned = toProperty(row({ presented_by_owner: true }), representative);
    expect(owned.presentedByOwner).toBe(true);
    expect("representation" in owned).toBe(false);
  });

  it("maps the rest of the row into the domain shape", () => {
    const property = toProperty(
      row({
        listing_url: "https://l.example/1",
        hero_rank: 2,
        related: ["p2"],
        architect: "A. Smith",
      }),
      representative,
    );
    expect(property).toMatchObject({
      market: "california",
      region: "bay-area",
      interiorSqFt: 3200,
      coordinates: [37.87, -122.45],
      publishedAt: "2026-08-14",
      architect: "A. Smith",
      listingUrl: "https://l.example/1",
      heroRank: 2,
      related: ["p2"],
    });
    expect(property.representation?.photo).toBe("/media/o/r1/0-0a0a0a0a.webp");
    expect("designer" in property).toBe(false);
    expect("featuredRank" in property).toBe(false);
    expect("related" in toProperty(row())).toBe(false);
  });
});

describe("toPropertyCard", () => {
  const gallery = Array.from({ length: 30 }, (_, index) => ({
    media_key: `o/p1/${String(index + 2)}-0badc0de.webp`,
    variants: SIZED,
    alt: "Room",
    orientation: "landscape" as const,
    sort_order: index + 1,
  }));
  const rich = () =>
    toProperty(
      row({
        video: { src: "v/a.mp4", poster: "v/a.jpg", caption: "c", duration: "0:18" },
        og_image_key: "o/p1/cover.jpg",
        media: [
          {
            media_key: MASTER,
            variants: SIZED,
            alt: "Front",
            orientation: "landscape",
            sort_order: 0,
          },
          ...gallery,
        ],
      }),
    );

  it("keeps a card variant and the card fields, with no gallery, video, og image or long text", () => {
    const property = rich();
    expect(property.gallery).toHaveLength(30);
    const card = toPropertyCard(property);
    expect(Object.keys(card)).not.toContain("gallery");
    for (const dropped of ["video", "ogImage", "story", "place", "address", "representation"]) {
      expect(Object.keys(card)).not.toContain(dropped);
    }
    expect(Object.keys(card.heroVariants ?? {})).toEqual(["card"]);
    expect(card).toMatchObject({
      slug: "p1",
      title: "Cliff House",
      heroImage: property.heroImage,
      features: ["Pool"],
      publishedAt: "2026-08-14",
    });
  });

  it("keeps a card at most 600 bytes as JSON for a property with a 30 photograph gallery", () => {
    expect(JSON.stringify(toPropertyCard(rich())).length).toBeLessThanOrEqual(600);
  });
});

const marketRow = {
  slug: "california" as const,
  name: "California",
  country: "United States",
  currency: "USD",
  intro: "Intro",
  places: ["Tiburon"],
  image: null,
  interest_copy: null,
};
const regionRow = {
  slug: "bay-area" as const,
  market_slug: "california" as const,
  name: "Bay Area",
  intro: "Region",
  places: [],
  image: null,
};

describe("images that are not stored yet (G55)", () => {
  it("maps a market, a region and a story with a null image to no image", () => {
    const market = toMarket(marketRow, { regions: [regionRow], notes: [], guide: [] }, false);
    expect("image" in market).toBe(false);
    expect(market.regions[0] && "image" in market.regions[0]).toBe(false);
    const story = toStory({
      id: "s1",
      slug: "s",
      title: "T",
      deck: "D",
      category: "Places",
      market_slug: "california",
      image: null,
      body: [],
      properties: [],
      published_at: "2026-05-01T00:00:00+00:00",
    });
    expect("image" in story).toBe(false);
  });

  it("maps a stored image to a site address", () => {
    const market = toMarket(
      { ...marketRow, image: "o/california/0-aaaaaaaa.webp" },
      { regions: [{ ...regionRow, image: "o/bay-area/0-bbbbbbbb.webp" }], notes: [], guide: [] },
      false,
    );
    expect(market.image).toBe("/media/o/california/0-aaaaaaaa.webp");
    expect(market.regions[0]?.image).toBe("/media/o/bay-area/0-bbbbbbbb.webp");
  });
});

const snapshot = {
  catalog_version: 7,
  markets: [marketRow, { ...marketRow, slug: "florida", name: "Florida", interest_copy: "Soon." }],
  regions: [regionRow],
  market_notes: [{ market_slug: "california", label: "Light", text: "Long light." }],
  market_guide_entries: [
    {
      market_slug: "california",
      section: "neighborhood",
      region_slug: "bay-area",
      label: "Belvedere",
      text: "Quiet.",
    },
    {
      market_slug: "california",
      section: "need",
      region_slug: null,
      label: "Privacy",
      text: "Often.",
    },
    {
      market_slug: "california",
      section: "service",
      region_slug: null,
      label: "Access",
      text: "Arranged.",
    },
  ],
  representatives: [],
  properties: [],
  stories: [],
  redirects: [{ from_path: "/summer", to_path: "/markets", status: 302 }],
  slug_history: [{ slug: "old", property_id: "00000000-0000-4000-8000-000000000001" }],
  gone: [],
};

describe("mapSnapshot", () => {
  it("takes comingSoon from the public state and groups a market's children", () => {
    const catalog = mapSnapshot(parseSnapshot(snapshot), {
      comingSoonGlobal: false,
      comingSoonMarkets: { california: false, florida: true },
    });
    expect(catalog.version).toBe(7);
    expect(catalog.markets.map((market) => [market.slug, market.comingSoon])).toEqual([
      ["california", false],
      ["florida", true],
    ]);
    const california = catalog.markets[0];
    expect(california?.regions.map((region) => region.slug)).toEqual(["bay-area"]);
    expect(california?.notes).toEqual([{ label: "Light", text: "Long light." }]);
    expect(california?.guide).toEqual({
      neighborhoods: [{ name: "Belvedere", region: "bay-area", text: "Quiet." }],
      needs: [{ label: "Privacy", text: "Often." }],
      service: [{ label: "Access", text: "Arranged." }],
    });
    expect(catalog.markets[1]?.interestCopy).toBe("Soon.");
    expect(catalog.redirects).toEqual(snapshot.redirects);
  });

  it("makes every market coming soon when the whole site is", () => {
    const catalog = mapSnapshot(parseSnapshot(snapshot), {
      comingSoonGlobal: true,
      comingSoonMarkets: {},
    });
    expect(catalog.markets.every((market) => market.comingSoon)).toBe(true);
  });

  it("refuses a published property that lacks a field the publish gate guarantees", () => {
    const incomplete = { ...snapshot, properties: [{ ...row(), price: null }] };
    expect(() => parseSnapshot(incomplete)).toThrow();
  });
});
