import { absoluteUrl, siteConfig } from "../../config/site";
import { getDb } from "../lib/db";
import { AppError, toErrorResponse } from "../lib/errors";
import { cachedResponse } from "./cache";
import { getCatalog, type ServedCatalog } from "./state";

// `GET /feed.xml` and `GET /feed.json` (B17 step 7): the newest properties and stories of the catalog snapshot,
// stored by the cache module as kind `doc`. The build reads `getCatalog` and nothing else, and nothing
// in it depends on the clock, so a stored copy is a pure function of the catalog version.

const ITEM_LIMIT = 50;

interface FeedItem {
  url: string;
  title: string;
  description: string;
  published: Date;
}

function itemsOf(catalog: ServedCatalog): FeedItem[] {
  const items = [
    ...catalog.properties.map((property) => ({
      url: absoluteUrl(`/property/${property.slug}`),
      title: property.title,
      description: property.place,
      published: new Date(property.publishedAt),
    })),
    ...catalog.stories.map((story) => ({
      url: absoluteUrl(`/stories/${story.slug}`),
      title: story.title,
      description: story.deck,
      published: new Date(story.publishedAt),
    })),
  ];
  return items.sort((a, b) => b.published.getTime() - a.published.getTime()).slice(0, ITEM_LIMIT);
}

const XML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};
const escapeXml = (text: string): string =>
  text.replace(/[&<>"']/g, (char) => XML_ESCAPES[char] ?? char);

const tag = (name: string, text: string): string => `<${name}>${escapeXml(text)}</${name}>`;

/** RFC 822 with a four-digit year and `GMT`, which `Date.prototype.toUTCString` writes. */
const rfc822 = (date: Date): string => date.toUTCString();

function rssOf(items: FeedItem[]): string {
  const newest = items[0];
  const channel = [
    tag("title", siteConfig.name),
    tag("link", absoluteUrl("/")),
    tag("description", siteConfig.description),
    tag("language", siteConfig.locale.toLowerCase()),
    ...(newest === undefined ? [] : [tag("lastBuildDate", rfc822(newest.published))]),
    `<atom:link href="${escapeXml(absoluteUrl("/feed.xml"))}" rel="self" type="application/rss+xml"/>`,
    ...items.map(
      (item) =>
        `<item>${tag("title", item.title)}${tag("link", item.url)}<guid isPermaLink="true">${escapeXml(item.url)}</guid>${tag("pubDate", rfc822(item.published))}${tag("description", item.description)}</item>`,
    ),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">\n<channel>\n${channel.join("\n")}\n</channel>\n</rss>\n`;
}

function jsonOf(items: FeedItem[]): string {
  return JSON.stringify({
    version: "https://jsonfeed.org/version/1.1",
    title: siteConfig.name,
    home_page_url: absoluteUrl("/"),
    feed_url: absoluteUrl("/feed.json"),
    description: siteConfig.description,
    language: siteConfig.locale,
    items: items.map((item) => ({
      id: item.url,
      url: item.url,
      title: item.title,
      content_text: item.description,
      date_published: item.published.toISOString(),
    })),
  });
}

const FORMATS = {
  rss: { build: rssOf, contentType: "application/rss+xml; charset=utf-8" },
  json: { build: jsonOf, contentType: "application/feed+json; charset=utf-8" },
} as const;

/** The feed in `format`, from the cache module or built from the catalog; a write is refused with its own 405. */
export function serveFeed(
  request: Request,
  requestId: string,
  format: keyof typeof FORMATS,
): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    const refused = toErrorResponse(
      new AppError("method_not_allowed", undefined, "This address does not accept that method."),
      requestId,
    );
    refused.headers.set("allow", "GET, HEAD");
    return Promise.resolve(refused);
  }
  const { build, contentType } = FORMATS[format];
  return cachedResponse(
    request,
    "doc",
    async () =>
      new Response(build(itemsOf(await getCatalog(getDb()))), {
        headers: { "content-type": contentType },
      }),
  );
}
