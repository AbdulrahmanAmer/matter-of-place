import { describe, expect, it } from "vitest";
import { properties as bundledProperties } from "../../src/data/properties";
import { stories as bundledStories } from "../../src/data/stories";
import type { Json } from "../../src/db";
import { applyVisibility } from "../../src/server/catalog/visibility";
import { mapSnapshot, parseSnapshot, toPropertyCard } from "../../src/server/public/mappers";
import type { PublicState, ServedCatalog } from "../../src/server/public/state";
import { buildSitemap, staticSitemapPaths } from "../../src/server/seo/sitemap";
import { propertyJson, snapshotJson } from "../fixtures/snapshot";

const NOW = new Date("2026-10-05T12:00:00Z");
const ORIGIN = "https://matterofplace.com";

const state: PublicState = {
  catalogVersion: 7,
  flags: {},
  comingSoonGlobal: false,
  comingSoonMarkets: {},
  site: {},
  illustrativeContent: false,
  ogStatic: {},
};

const market = (slug: string, name: string): Json => ({
  slug,
  name,
  country: "United States",
  currency: "USD",
  intro: "An intro.",
  places: [],
  image: null,
  interest_copy: null,
});
const region = (slug: string, marketSlug: string, name: string): Json => ({
  slug,
  market_slug: marketSlug,
  name,
  intro: "An intro.",
  places: [],
  image: null,
});
const MARKETS = [market("california", "California"), market("florida", "Florida")];
const REGIONS = [
  region("bay-area", "california", "Bay Area"),
  region("los-angeles", "california", "Los Angeles"),
  region("miami", "florida", "Miami"),
];

const idOf = (slug: string): string => `00000000-0000-4000-8000-${slug.padStart(12, "0")}`;

function property(slug: string, extra: Record<string, Json> = {}): Json {
  const base = propertyJson(slug);
  if (typeof base !== "object" || base === null || Array.isArray(base)) {
    throw new Error("propertyJson returned a value that is not an object");
  }
  return { ...base, ...extra };
}

const story = (slug: string, extra: Record<string, Json> = {}): Json => ({
  id: `story-${slug}`,
  slug,
  title: "A quiet house",
  deck: "A deck.",
  category: "Places",
  market_slug: "california",
  image: null,
  body: ["One."],
  properties: [],
  published_at: "2026-09-01T00:00:00+00:00",
  updated_at: "2026-09-02T10:00:00+00:00",
  ...extra,
});

/** The catalog as `getCatalog` serves it: mapped, then filtered for visibility, with the list cards. */
function served(
  parts: Record<string, Json>,
  over: Partial<PublicState> = {},
): { catalog: ServedCatalog; state: PublicState } {
  const current = { ...state, ...over };
  const mapped = mapSnapshot(
    parseSnapshot(snapshotJson(7, { markets: MARKETS, regions: REGIONS, ...parts })),
    current,
  );
  const visible = applyVisibility(mapped, { state: current, env: { MOP_ENV: "production" } });
  return {
    catalog: { ...visible, cards: visible.properties.map(toPropertyCard) },
    state: current,
  };
}

function sitemapOf(parts: Record<string, Json>, over: Partial<PublicState> = {}): string {
  const { catalog, state: current } = served(parts, over);
  return buildSitemap(catalog, current, NOW);
}

const locs = (xml: string): string[] =>
  [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].flatMap((match) => match[1] ?? []);
const paths = (xml: string): string[] => locs(xml).map((loc) => loc.slice(ORIGIN.length));
const lastmodOf = (xml: string, path: string): string | undefined =>
  new RegExp(`<loc>${ORIGIN}${path}</loc><lastmod>([^<]*)</lastmod>`).exec(xml)?.[1];

describe("staticSitemapPaths", () => {
  it("lists the public pages, the legal pages and the notes page, and neither noindex page", () => {
    expect([...staticSitemapPaths]).toEqual([
      "/",
      "/properties",
      "/markets",
      "/stories",
      "/editorial-standard",
      "/submit",
      "/exposure",
      "/about",
      "/contact",
      "/faq",
      "/legal",
      "/privacy",
      "/terms",
      "/accessibility",
      "/cookies",
      "/place-notes",
    ]);
    expect(staticSitemapPaths).toEqual(
      expect.arrayContaining(["/privacy", "/terms", "/accessibility", "/cookies", "/place-notes"]),
    );
    expect(staticSitemapPaths).not.toContain("/privacy-request");
    expect(staticSitemapPaths).not.toContain("/privacy-choices");
  });
});

describe("buildSitemap pages", () => {
  it("lists a published property with its market and region, and /properties", () => {
    expect(paths(sitemapOf({}))).toEqual(
      expect.arrayContaining([
        "/properties",
        "/property/p1",
        "/california",
        "/california/bay-area",
      ]),
    );
  });

  it("leaves out a market and a region with no published property, and /properties while there is none", () => {
    const listed = paths(sitemapOf({}));
    expect(listed).not.toContain("/florida");
    expect(listed).not.toContain("/florida/miami");
    expect(listed).not.toContain("/california/los-angeles");
    const empty = paths(sitemapOf({ properties: [] }));
    expect(empty).not.toContain("/properties");
    expect(empty).not.toContain("/california");
    expect(empty).toContain("/markets");
  });

  it("lists /<market>/guide for every market while the market has no published property", () => {
    expect(paths(sitemapOf({ properties: [] }))).toEqual(
      expect.arrayContaining(["/california/guide", "/florida/guide"]),
    );
  });

  it("leaves out a property the catalog hides, here one in a coming-soon market", () => {
    const listed = paths(
      sitemapOf({ properties: [property("hidden")] }, { comingSoonMarkets: { california: true } }),
    );
    expect(listed).not.toContain("/property/hidden");
    expect(listed).not.toContain("/california");
  });

  it("leaves out a taken-down property", () => {
    const listed = paths(
      sitemapOf({ properties: [property("kept"), property("taken")], gone: ["taken"] }),
    );
    expect(listed).toContain("/property/kept");
    expect(listed).not.toContain("/property/taken");
  });

  it("lists a story", () => {
    expect(paths(sitemapOf({ stories: [story("a-quiet-house")] }))).toContain(
      "/stories/a-quiet-house",
    );
  });
});

describe("buildSitemap archive pages", () => {
  const styled = (count: number): Json[] =>
    Array.from({ length: count }, (_unused, index) =>
      property(`s${String(index)}`, { style: "Modernist" }),
    );
  const archives = (xml: string): string[] =>
    paths(xml).filter((path) => path.startsWith("/archive/"));

  it("lists the facets of three properties while the archive flag is on", () => {
    expect(
      archives(sitemapOf({ properties: styled(3) }, { flags: { archive_pages: true } })),
    ).toEqual(["/archive/city/tiburon-ca", "/archive/style/modernist"]);
  });

  it("leaves out a facet of two properties", () => {
    expect(
      archives(sitemapOf({ properties: styled(2) }, { flags: { archive_pages: true } })),
    ).toEqual([]);
  });

  it("leaves out every facet while the archive flag is off", () => {
    expect(archives(sitemapOf({ properties: styled(3) }))).toEqual([]);
  });
});

describe("buildSitemap redirects", () => {
  const rows = (): Record<string, Json> => ({
    properties: [property("new-name"), property("old-name")],
    slug_history: [{ slug: "old-name", property_id: idOf("new-name") }],
  });

  it("leaves out a slug that slug_history moved to another one", () => {
    const listed = paths(sitemapOf(rows()));
    expect(listed).toContain("/property/new-name");
    expect(listed).not.toContain("/property/old-name");
  });

  it("keeps a slug that is the current one of its own history row", () => {
    const listed = paths(
      sitemapOf({
        properties: [property("same")],
        slug_history: [{ slug: "same", property_id: idOf("same") }],
      }),
    );
    expect(listed).toContain("/property/same");
  });

  it("leaves out a path that an active redirect answers", () => {
    const redirects = [{ from_path: "/about", to_path: "/faq", status: 301 }];
    expect(paths(sitemapOf({ redirects }))).not.toContain("/about");
  });

  it("keeps a path whose redirect row is archived, because the snapshot never carries it", () => {
    expect(paths(sitemapOf({ redirects: [] }))).toContain("/about");
  });
});

describe("buildSitemap lastmod", () => {
  it("takes updatedAt for a property and a story", () => {
    const xml = sitemapOf({
      properties: [property("p1", { updated_at: "2026-09-20T08:30:00+00:00" })],
      stories: [story("s1")],
    });
    expect(lastmodOf(xml, "/property/p1")).toBe("2026-09-20");
    expect(lastmodOf(xml, "/stories/s1")).toBe("2026-09-02");
  });

  it("falls back to publishedAt where updatedAt is absent, as it is on the bundled data", () => {
    const [bundled] = bundledProperties;
    const [bundledStory] = bundledStories;
    if (bundled === undefined || bundledStory === undefined) throw new Error("no bundled data");
    const { catalog, state: current } = served({});
    const xml = buildSitemap(
      { ...catalog, properties: [bundled], stories: [bundledStory], cards: [] },
      current,
      NOW,
    );
    expect(lastmodOf(xml, `/property/${bundled.slug}`)).toBe(bundled.publishedAt.slice(0, 10));
    expect(lastmodOf(xml, `/stories/${bundledStory.slug}`)).toBe(
      bundledStory.publishedAt.slice(0, 10),
    );
  });

  it("never dates a page after the day of the build", () => {
    const xml = sitemapOf({
      properties: [property("p1", { updated_at: "2027-01-01T00:00:00+00:00" })],
    });
    expect(lastmodOf(xml, "/property/p1")).toBe("2026-10-05");
  });
});

describe("buildSitemap images", () => {
  const MASTER = "o/p/0-abcd1234.webp";
  const SIZED = {
    thumb: { w: 320, h: 213 },
    card: { w: 720, h: 480 },
    hero: { w: 1600, h: 1067 },
    og: { w: 1200, h: 630 },
    carousel: { w: 1080, h: 1350 },
  };
  const photo = (index: number, alt: string, variants: Json): Json => ({
    id: `m${String(index)}`,
    media_key: `o/p/${String(index)}-abcd1234.webp`,
    variants,
    alt,
    orientation: "landscape",
    sort_order: index,
  });

  it("writes the hero variant as an absolute image:loc and the gallery's with its alt text", () => {
    const xml = sitemapOf({
      properties: [
        property("p1", {
          hero_image: MASTER,
          media: [photo(0, "Front", SIZED), photo(1, "Kitchen & pantry", SIZED)],
        }),
      ],
    });
    expect(xml).toContain(`<image:loc>${ORIGIN}/media/v/p/0-abcd1234/hero.webp</image:loc>`);
    expect(xml).toContain(
      `<image:loc>${ORIGIN}/media/v/p/1-abcd1234/hero.webp</image:loc><image:caption>Kitchen &amp; pantry</image:caption>`,
    );
    expect(xml).toContain('xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"');
  });

  it("lists no more than 20 images for one page", () => {
    const media = Array.from({ length: 25 }, (_unused, index) =>
      photo(index, `Room ${String(index)}`, SIZED),
    );
    const xml = sitemapOf({ properties: [property("p1", { hero_image: MASTER, media })] });
    expect(xml.split("<image:image>").length - 1).toBe(20);
  });

  it("gives a photograph that is not rendered no image entry", () => {
    const xml = sitemapOf({
      properties: [property("p1", { hero_image: MASTER, media: [photo(0, "Front", {})] })],
    });
    expect(xml).not.toContain("image:image");
  });

  it("gives a bundled /assets/ hero no image entry", () => {
    const [bundled] = bundledProperties;
    if (bundled === undefined) throw new Error("no bundled data");
    const { catalog, state: current } = served({});
    const xml = buildSitemap(
      {
        ...catalog,
        properties: [{ ...bundled, heroImage: "/assets/x.jpg", gallery: [] }],
        cards: [],
      },
      current,
      NOW,
    );
    expect(xml).toContain(`/property/${bundled.slug}`);
    expect(xml).not.toContain("image:image");
  });
});
