import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { markets } from "../../src/data/markets";
import { properties } from "../../src/data/properties";
import { ogImageFor, ogStaticOf } from "../../src/lib/og";
import { getOgStaticFn } from "../../src/lib/og.functions";
import { Route as MarketRoute } from "../../src/routes/_site.$market.index";
import { Route as HomeRoute } from "../../src/routes/_site.index";
import { Route as PropertyRoute } from "../../src/routes/_site.property.$slug";

const mocks = vi.hoisted<{ ogStatic: Record<string, unknown> }>(() => ({ ogStatic: {} }));
// The Start compiler is absent in a unit test: `handler(fn)` gives `fn` back, so the test calls the handler itself.
interface Builder {
  validator: () => Builder;
  handler: (fn: unknown) => unknown;
}
vi.mock("@tanstack/react-start", async (importOriginal) => {
  const builder: Builder = { validator: () => builder, handler: (fn) => fn };
  return {
    ...(await importOriginal<object>()),
    createServerFn: () => builder,
  };
});
vi.mock("../../src/server/lib/db", () => ({ getDb: () => ({}) }));
vi.mock("../../src/server/public/state", () => ({
  getPublicState: () => Promise.resolve({ ogStatic: mocks.ogStatic }),
}));

const MEDIA = "https://matterofplace.com/media";
const COVER = `${MEDIA}/v/p1/0-ab12cd34/cover.jpg`;
const HERO_OG = `${MEDIA}/v/p1/0-ab12cd34/og.jpg`;
const COMMITTED = "https://matterofplace.com/og/static";
const heroVariants = (jpg: string) => ({ og: { jpg, w: 1200, h: 630 } });

afterEach(() => {
  vi.unstubAllEnvs();
  mocks.ogStatic = {};
});

describe("ogImageFor, a property", () => {
  it("prefers an absolute ogImage to an absolute hero og variant", () => {
    const image = ogImageFor({
      key: "default",
      property: { title: "Cliff House", ogImage: COVER, heroVariants: heroVariants(HERO_OG) },
    });
    expect(image).toEqual({ url: COVER, width: 1200, height: 630, alt: "Cliff House" });
  });

  it("falls through a bare ogImage key to the hero og variant", () => {
    const image = ogImageFor({
      key: "default",
      property: {
        title: "Cliff House",
        ogImage: "/media/v/p1/0-ab12cd34/cover.jpg",
        heroVariants: heroVariants(HERO_OG),
      },
    });
    expect(image.url).toBe(HERO_OG);
  });

  it("prefers an absolute https hero og variant to the static card", () => {
    const image = ogImageFor({
      key: "default",
      property: { title: "Cliff House", heroVariants: heroVariants(HERO_OG) },
      ogStatic: { default: `${MEDIA}/og/static/default.aaaaaaaa.png` },
    });
    expect(image.url).toBe(HERO_OG);
  });

  it("refuses an http address and falls to the static card", () => {
    const image = ogImageFor({
      key: "default",
      property: { title: "Cliff House", ogImage: "http://matterofplace.com/media/c.jpg" },
    });
    expect(image.url).toBe(`${COMMITTED}/default.png`);
  });

  it("falls back to the default card when nothing is absolute", () => {
    const image = ogImageFor({
      key: "default",
      property: {
        title: "Cliff House",
        ogImage: "/media/c.jpg",
        heroVariants: heroVariants("/media/og.jpg"),
      },
    });
    expect(image).toEqual({
      url: `${COMMITTED}/default.png`,
      width: 1200,
      height: 630,
      alt: "Matter of Place",
    });
  });
});

describe("ogImageFor, a page with no property", () => {
  it("prefers an absolute ogStatic entry to the committed card", () => {
    const newer = `${MEDIA}/og/static/home.0123abcd.png`;
    expect(ogImageFor({ key: "home", ogStatic: { home: newer } }).url).toBe(newer);
  });

  it.each([
    ["a bare entry", { home: "/media/og/static/home.0123abcd.png" }],
    ["no entry for the key", { markets: `${MEDIA}/og/static/markets.0123abcd.png` }],
    ["no ogStatic at all", undefined],
  ])("uses the committed card for %s", (_name, ogStatic) => {
    expect(ogImageFor({ key: "home", ogStatic }).url).toBe(`${COMMITTED}/home.png`);
  });

  it("gives a market page its own card", () => {
    expect(ogImageFor({ key: "market-california" }).url).toBe(`${COMMITTED}/market-california.png`);
  });
});

describe("ogStaticOf", () => {
  it("reads the map the root loader returned", () => {
    expect(ogStaticOf([{ loaderData: { ogStatic: { home: `${MEDIA}/h.png` } } }])).toEqual({
      home: `${MEDIA}/h.png`,
    });
  });

  it.each([
    ["no match", []],
    ["a root that has not loaded", [{ loaderData: undefined }]],
    ["a loader result of another shape", [{ loaderData: { ogStatic: 3 } }]],
  ])("gives nothing for %s", (_name, matches) => {
    expect(ogStaticOf(matches)).toBeUndefined();
  });
});

describe("getOgStaticFn", () => {
  it("returns {} while the media base is unset, so only a bare key is known", async () => {
    mocks.ogStatic = { home: { media_key: "og/static/home.0123abcd.png", w: 1200, h: 630 } };
    expect(await getOgStaticFn()).toEqual({});
  });

  it("returns the absolute address of an entry once the media base is set", async () => {
    vi.stubEnv("MEDIA_PUBLIC_BASE", MEDIA);
    mocks.ogStatic = { home: { media_key: "og/static/home.0123abcd.png", w: 1200, h: 630 } };
    expect(await getOgStaticFn()).toEqual({ home: `${MEDIA}/og/static/home.0123abcd.png` });
  });

  it("drops a row that is not a card and an address that is not https", async () => {
    vi.stubEnv("MEDIA_PUBLIC_BASE", "http://localhost:8080/media");
    mocks.ogStatic = { home: { media_key: "og/static/home.png" }, markets: "og/static/m.png" };
    expect(await getOgStaticFn()).toEqual({});
  });
});

describe("the og:image of a route head", () => {
  const headShape = z.object({ meta: z.array(z.record(z.string(), z.unknown())) });
  /** The route's own head(), called as the router calls it: with the root loader's result among the matches. */
  function ogImageOf(head: unknown, loaderData: unknown, ogStatic?: Record<string, string>) {
    if (typeof head !== "function") throw new Error("the route has no head()");
    const matches = ogStatic === undefined ? [] : [{ loaderData: { ogStatic } }];
    const result: unknown = Reflect.apply(head, undefined, [{ loaderData, params: {}, matches }]);
    return headShape.parse(result).meta.find((tag) => tag["property"] === "og:image")?.["content"];
  }
  const [california] = markets;
  const [property] = properties;
  const region = california?.regions[0];
  if (california === undefined || property === undefined || region === undefined) {
    throw new Error("the bundled data is not what the cases below expect");
  }

  it("gives the home page its static card, the newer one when the root loader has it", () => {
    const newer = `${MEDIA}/og/static/home.0123abcd.png`;
    expect(ogImageOf(HomeRoute.options.head, undefined)).toBe(`${COMMITTED}/home.png`);
    expect(ogImageOf(HomeRoute.options.head, undefined, { home: newer })).toBe(newer);
  });

  it("gives a market page the card of its market", () => {
    const data = { market: california, pool: [], recent: [], stories: [] };
    expect(ogImageOf(MarketRoute.options.head, data)).toBe(`${COMMITTED}/market-california.png`);
  });

  it("gives a property page its cover, and the default card while it has none", () => {
    const data = (cover?: string) => ({
      property: { ...property, ...(cover === undefined ? {} : { ogImage: cover }) },
      market: california,
      region,
    });
    expect(ogImageOf(PropertyRoute.options.head, data(COVER))).toBe(COVER);
    expect(ogImageOf(PropertyRoute.options.head, data())).toBe(`${COMMITTED}/default.png`);
  });
});
