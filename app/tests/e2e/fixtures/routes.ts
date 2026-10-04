// The route list of the sweep (B4 step 5) and the map that makes "a page route has a Playwright test" mechanical:
// `tests/unit/routes-covered.test.ts` reads `src/routes` and fails on a file this map does not name.
import { readdirSync } from "node:fs";
import { register } from "node:module";
import { fileURLToPath } from "node:url";
import { z } from "zod";

export type RouteMode = "local" | "live";

export type RouteClass =
  | "home"
  | "page"
  | "market"
  | "guide"
  | "region"
  | "property"
  | "story"
  | "faq"
  | "exposure"
  | "notFound";

export type SweepRoute = { path: string; pattern: string; routeClass: RouteClass };

/** What `classifyRouteFile` and `routeFileCoverage` answer: a swept pattern, or one of three kinds of file. */
export type RouteFileEntry = "redirect" | "server" | "layout" | `/${string}`;

export const sitemapRoute = "/sitemap.xml";
export const notFoundRoute: SweepRoute = {
  path: "/no-such-page",
  pattern: "/no-such-page",
  routeClass: "notFound",
};

const staticPaths: [string, RouteClass][] = [
  ["/", "home"],
  ["/properties", "page"],
  ["/markets", "page"],
  ["/stories", "page"],
  ["/editorial-standard", "page"],
  ["/submit", "page"],
  ["/exposure", "exposure"],
  ["/about", "page"],
  ["/contact", "page"],
  ["/faq", "faq"],
  ["/legal", "page"],
];

export const staticRoutes: SweepRoute[] = staticPaths.map(([path, routeClass]) => ({
  path,
  pattern: path,
  routeClass,
}));

/** Every redirect the site keeps for old links, all permanent (`redirects.spec.ts` iterates this list). */
export const redirects: { from: string; to: string; status: 301 }[] = [
  { from: "/markets/california", to: "/california", status: 301 },
  { from: "/place-notes", to: "/stories", status: 301 },
  { from: "/pricing", to: "/exposure", status: 301 },
  { from: "/california/san-diego", to: "/california/la-jolla", status: 301 },
];

/** The route class decides which structured-data types a page must carry; an empty list accepts any valid block. */
export const jsonLdExpectations: Record<RouteClass, string[]> = {
  home: ["Organization"],
  page: [],
  market: [],
  guide: [],
  region: [],
  property: ["SingleFamilyResidence"],
  story: [],
  faq: ["FAQPage"],
  exposure: ["FAQPage"],
  notFound: [],
};

const ROUTES_DIR = fileURLToPath(new URL("../../../src/routes", import.meta.url));

/** Every file under `src/routes`, relative and with forward slashes. */
export const routeFiles: string[] = readdirSync(ROUTES_DIR, { recursive: true, encoding: "utf8" })
  .map((name) => name.replaceAll("\\", "/"))
  .filter((name) => /\.tsx?$/.test(name))
  .sort();

/** Every other file under `src/routes`: the pattern it serves, `redirect`, `server` or `layout`. */
export const routeFileCoverage: Record<string, RouteFileEntry> = {
  "__root.tsx": "layout",
  "_site.tsx": "layout",
  "_site.$market.tsx": "layout",
  "_site.markets.tsx": "layout",
  "_site.stories.tsx": "layout",
  "_site.index.tsx": "/",
  "_site.properties.tsx": "/properties",
  "_site.markets.index.tsx": "/markets",
  "_site.stories.index.tsx": "/stories",
  "_site.editorial-standard.tsx": "/editorial-standard",
  "_site.submit.tsx": "/submit",
  "_site.exposure.tsx": "/exposure",
  "_site.about.tsx": "/about",
  "_site.contact.tsx": "/contact",
  "_site.faq.tsx": "/faq",
  "_site.legal.tsx": "/legal",
  "_site.$market.index.tsx": "/$market",
  "_site.$market.guide.tsx": "/$market/guide",
  "_site.$market.$region.tsx": "/$market/$region",
  "_site.property.$slug.tsx": "/property/$slug",
  "_site.stories.$slug.tsx": "/stories/$slug",
  "_site.markets.$.tsx": "redirect",
  "_site.place-notes.tsx": "redirect",
  "_site.pricing.tsx": "redirect",
  "media.$.ts": "server",
  "sitemap[.]xml.ts": sitemapRoute,
};

export type RouteFileClass = RouteFileEntry | "admin";

/** Path rules first: API files are `server`, admin files are `admin` (B7's project); the rest need an entry. */
export function classifyRouteFile(path: string): RouteFileClass | undefined {
  if (path.startsWith("api/")) return "server";
  if (path === "admin.tsx" || path.startsWith("admin/")) return "admin";
  return routeFileCoverage[path];
}

const SEO_FILE = /^(robots|llms|llms-full)\[\.\]txt\.tsx?$/;

/** `/robots.txt`, `/llms.txt` and `/llms-full.txt`, each only while its route file exists. */
export const seoFileRoutes: string[] = routeFiles
  .filter((name) => SEO_FILE.test(name))
  .map((name) => `/${name.replace("[.]", ".").replace(/\.tsx?$/, "")}`);

/** The patterns of the dynamic routes. */
export const dynamicPatterns = {
  market: "/$market",
  guide: "/$market/guide",
  region: "/$market/$region",
  property: "/property/$slug",
  story: "/stories/$slug",
} as const;

type Params = {
  markets: { slug: string; regions: string[] }[];
  properties: string[];
  stories: string[];
};

// `src/data` imports its photographs; Node cannot load an image, so each one resolves to an empty module.
const IMAGE_STUB = `export async function resolve(specifier, context, next) {
  if (/\\.(jpe?g|png|webp)$/.test(specifier)) return { url: "data:text/javascript,export default ''", shortCircuit: true };
  return next(specifier, context);
}`;

async function localParams(): Promise<Params> {
  register(`data:text/javascript,${encodeURIComponent(IMAGE_STUB)}`);
  const [{ markets }, { properties }, { stories }] = await Promise.all([
    import("../../../src/data/markets"),
    import("../../../src/data/properties"),
    import("../../../src/data/stories"),
  ]);
  return {
    markets: markets.map((market) => ({
      slug: market.slug,
      regions: market.regions.map((region) => region.slug),
    })),
    properties: properties.map((property) => property.slug),
    stories: stories.map((story) => story.slug),
  };
}

const slugList = z.array(z.object({ slug: z.string() }));
const marketList = z.array(z.object({ slug: z.string(), regions: slugList }));

async function getJson(base: string, path: string): Promise<unknown> {
  const response = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok)
    throw new Error(`E2E_MODE=live: ${path} answered ${response.status.toString()}`);
  return response.json();
}

async function liveParams(): Promise<Params> {
  const base = process.env["E2E_BASE_URL"];
  if (base === undefined || base === "") throw new Error("E2E_MODE=live needs E2E_BASE_URL");
  const home = await fetch(`${base}/`, { signal: AbortSignal.timeout(15_000) });
  if (!/<body[^>]*\sdata-services="live"/.test(await home.text())) {
    throw new Error(
      'E2E_MODE=live, but the home page body does not carry data-services="live": this build uses the local adapter',
    );
  }
  const [markets, properties, stories] = await Promise.all([
    getJson(base, "/api/public/markets"),
    getJson(base, "/api/public/properties"),
    getJson(base, "/api/public/stories"),
  ]);
  return {
    markets: marketList.parse(markets).map((market) => ({
      slug: market.slug,
      regions: market.regions.map((region) => region.slug),
    })),
    properties: slugList.parse(properties).map((property) => property.slug),
    stories: slugList.parse(stories).map((story) => story.slug),
  };
}

/** The dynamic routes of one mode: bundled data in `local`, the target's public API in `live`. */
export async function getDynamicRoutes(
  mode: RouteMode = process.env["E2E_MODE"] === "live" ? "live" : "local",
): Promise<SweepRoute[]> {
  const params = mode === "live" ? await liveParams() : await localParams();
  return [
    ...params.markets.map(({ slug }) => ({
      path: `/${slug}`,
      pattern: dynamicPatterns.market,
      routeClass: "market" as const,
    })),
    ...params.markets.map(({ slug }) => ({
      path: `/${slug}/guide`,
      pattern: dynamicPatterns.guide,
      routeClass: "guide" as const,
    })),
    ...params.markets.flatMap((market) =>
      market.regions.map((slug) => ({
        path: `/${market.slug}/${slug}`,
        pattern: dynamicPatterns.region,
        routeClass: "region" as const,
      })),
    ),
    ...params.properties.map((slug) => ({
      path: `/property/${slug}`,
      pattern: dynamicPatterns.property,
      routeClass: "property" as const,
    })),
    ...params.stories.map((slug) => ({
      path: `/stories/${slug}`,
      pattern: dynamicPatterns.story,
      routeClass: "story" as const,
    })),
  ];
}
