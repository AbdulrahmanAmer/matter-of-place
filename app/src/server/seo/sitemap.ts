import { absoluteUrl } from "../../config/site.ts";
import type { Property } from "../../domain/property.ts";
import { indexable } from "../../lib/seo.ts";
import { loadRedirectMap } from "../public/redirects.ts";
import type { PublicState, ServedCatalog } from "../public/state.ts";
import { listFacets } from "./archive.ts";

/**
 * The XML sitemap, a pure function over the output of `getCatalog` and `getPublicState` (architecture 13 rule 1):
 * it takes no client and runs no query. A page that is not for the index is not listed: an empty market, region
 * or `/properties`, an archive below its threshold, a taken-down property and every path that answers a redirect.
 */
export const staticSitemapPaths = [
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
] as const;

const MAX_IMAGES = 20;
// Only the renditions made once from a stored photograph are public; a bundled `/assets/` file is not on our media path.
const VARIANT_PREFIX = "/media/v/";

type Source = Pick<
  ServedCatalog,
  "properties" | "markets" | "stories" | "cards" | "redirects" | "slugHistory" | "gone"
>;

interface Image {
  address: string;
  caption: string;
}

interface Entry {
  path: string;
  lastmod?: string;
  images?: Image[];
}

const entities: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};
const escapeXml = (text: string): string =>
  text.replace(/[&<>"']/g, (char) => entities[char] ?? char);

/** The day of a stored timestamp, never later than `now`: a clock that ran ahead must not date a page in the future. */
function lastmodOf(updatedAt: string | undefined, publishedAt: string, now: Date): string {
  const day = (updatedAt ?? publishedAt).slice(0, 10);
  const today = now.toISOString().slice(0, 10);
  return day > today ? today : day;
}

function imagesOf(property: Property): Image[] {
  const photographs = [
    { address: property.heroImage, caption: property.title },
    ...property.gallery.map((photo) => ({
      address: photo.variants?.hero?.webp ?? "",
      caption: photo.alt,
    })),
  ];
  return photographs
    .filter(({ address }) => address.startsWith(VARIANT_PREFIX))
    .slice(0, MAX_IMAGES);
}

const imageXml = ({ address, caption }: Image): string =>
  `<image:image><image:loc>${escapeXml(absoluteUrl(address))}</image:loc>${
    caption === "" ? "" : `<image:caption>${escapeXml(caption)}</image:caption>`
  }</image:image>`;

const entryXml = ({ path, lastmod, images = [] }: Entry): string =>
  `<url><loc>${escapeXml(absoluteUrl(path))}</loc>${
    lastmod === undefined ? "" : `<lastmod>${lastmod}</lastmod>`
  }${images.map(imageXml).join("")}</url>`;

const listed = (count: number): boolean => indexable(count).robots === undefined;

export function buildSitemap(source: Source, state: PublicState, now: Date): string {
  const taken = new Set(source.gone);
  const properties = source.properties.filter(({ slug }) => !taken.has(slug));
  const countIn = (market: string, region?: string): number =>
    properties.filter(
      (property) =>
        property.market === market && (region === undefined || property.region === region),
    ).length;

  const entries: Entry[] = [
    ...staticSitemapPaths
      .filter((path) => path !== "/properties" || listed(properties.length))
      .map((path) => ({ path })),
    ...source.markets.flatMap((market) => [
      ...(listed(countIn(market.slug)) ? [{ path: `/${market.slug}` }] : []),
      { path: `/${market.slug}/guide` },
      ...market.regions
        .filter((region) => listed(countIn(market.slug, region.slug)))
        .map((region) => ({ path: `/${market.slug}/${region.slug}` })),
    ]),
    ...listFacets(source, state).map(({ kind, slug }) => ({ path: `/archive/${kind}/${slug}` })),
    ...properties.map((property) => ({
      path: `/property/${property.slug}`,
      lastmod: lastmodOf(property.updatedAt, property.publishedAt, now),
      images: imagesOf(property),
    })),
    ...source.stories.map((story) => ({
      path: `/stories/${story.slug}`,
      lastmod: lastmodOf(story.updatedAt, story.publishedAt, now),
    })),
  ];

  const redirected = loadRedirectMap(source);
  const urls = entries.filter(({ path }) => !redirected.has(path)).map(entryXml);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n${urls.join("\n")}\n</urlset>\n`;
}
