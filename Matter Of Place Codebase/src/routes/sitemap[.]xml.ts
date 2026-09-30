import { createFileRoute } from "@tanstack/react-router";
import { absoluteUrl } from "../config/site";
import { services } from "../services";

const staticPaths = [
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
];

const entry = (path: string, lastmod?: string) =>
  `<url><loc>${absoluteUrl(path)}</loc>${lastmod ? `<lastmod>${lastmod.slice(0, 10)}</lastmod>` : ""}</url>`;

/** XML sitemap built from the catalog; cached like every other catalog read. */
export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        const [properties, markets, stories] = await Promise.all([
          services.catalog.listProperties(),
          services.catalog.listMarkets(),
          services.catalog.listStories(),
        ]);
        const urls = [
          ...staticPaths.map((path) => entry(path)),
          ...markets.flatMap((market) => [
            entry(`/${market.slug}`),
            entry(`/${market.slug}/guide`),
            ...market.regions.map((region) => entry(`/${market.slug}/${region.slug}`)),
          ]),
          ...properties.map((property) =>
            entry(`/property/${property.slug}`, property.publishedAt),
          ),
          ...stories.map((story) => entry(`/stories/${story.slug}`, story.publishedAt)),
        ];
        const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
        return new Response(body, {
          headers: {
            "content-type": "application/xml; charset=utf-8",
            "cache-control": "public, s-maxage=300, stale-while-revalidate=86400",
          },
        });
      },
    },
  },
});
