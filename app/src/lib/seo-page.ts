import type { Article, Service } from "schema-dts";
import { absoluteUrl, siteConfig } from "../config/site";
import { seoPageAt } from "../content/seo";
import type { SeoPageContent } from "../content/seo/types";
import { breadcrumbLd, type Crumb } from "./jsonld";
import { ogImageFor, ogStaticOf } from "./og";
import { faqJsonLd, pageHead } from "./seo";

/**
 * The head, structured data and inline links of the search pages in `src/content/seo`. A page is static content:
 * nothing here reads a table, so a warm request costs no query (architecture 13).
 */

/** Pages that exist besides the registry. A test holds this list inside the sitemap's static paths. */
export const servedStaticPaths: ReadonlySet<string> = new Set([
  "/",
  "/about",
  "/contact",
  "/editorial-standard",
  "/exposure",
  "/faq",
  "/place-notes",
  "/submit",
]);

/** True when a page answers at `path`: a registry page, `/guides` or one of the static pages above. */
export const isServedPath = (path: string): boolean =>
  path === "/guides" || servedStaticPaths.has(path) || seoPageAt(path) !== undefined;

type InlinePart = { text: string; to?: string };

const INLINE_LINK = /\[([^\]]+)\]\((\/[^)\s]*)\)/g;

/**
 * Splits a paragraph written with `[anchor](/path)` links into parts. A link to a path no page serves yet is kept as
 * plain text, so a page can name a sibling before the sibling is written.
 */
export function splitInline(text: string): InlinePart[] {
  const parts: InlinePart[] = [];
  let from = 0;
  for (const match of text.matchAll(INLINE_LINK)) {
    const [whole = "", anchor = "", to = ""] = match;
    if (match.index > from) parts.push({ text: text.slice(from, match.index) });
    parts.push(isServedPath(to) ? { text: anchor, to } : { text: anchor });
    from = match.index + whole.length;
  }
  if (from < text.length) parts.push({ text: text.slice(from) });
  return parts;
}

/** The pages `related` names that exist, with the anchors the brief gives. */
export const servedRelated = (page: SeoPageContent): SeoPageContent["related"] =>
  page.related.filter(({ to }) => isServedPath(to));

/** The trail after Home: a guide sits under `/guides`. */
function seoPageCrumbs(page: SeoPageContent): Crumb[] {
  return [
    ...(page.kind === "guide" ? [{ name: "Guides", path: "/guides" }] : []),
    { name: page.h1, path: page.path },
  ];
}

/** The nodes of the page's graph: the breadcrumb, then the types the content asks for. */
export function seoPageJsonLd(page: SeoPageContent): object[] {
  const url = absoluteUrl(page.path);
  const provider = { "@type": "Organization", name: siteConfig.name, url: siteConfig.url } as const;
  const article: Article = {
    "@type": "Article",
    "@id": `${url}#primary`,
    mainEntityOfPage: url,
    headline: page.h1,
    description: page.description,
    datePublished: page.published,
    dateModified: page.updated,
    author: provider,
    publisher: provider,
  };
  const service: Service = {
    "@type": "Service",
    "@id": `${url}#primary`,
    name: page.h1,
    description: page.description,
    serviceType: "Editorial property feature",
    provider,
    areaServed: ["California", "New York", "Florida"],
  };
  const hasPrimary = page.schema.includes("Article") || page.schema.includes("Service");
  const faq = faqJsonLd(page.faq);
  return [
    breadcrumbLd(seoPageCrumbs(page)),
    ...(page.schema.includes("Article") ? [article] : []),
    ...(page.schema.includes("Service") ? [service] : []),
    ...(page.schema.includes("FAQPage")
      ? [hasPrimary ? { "@id": `${url}#faq`, ...faq } : faq]
      : []),
  ];
}

/** The `head()` of a search page, from its content alone. */
export function seoPageHead(page: SeoPageContent, matches: Parameters<typeof ogStaticOf>[0]) {
  return pageHead({
    title: page.title,
    description: page.description,
    path: page.path,
    type: page.kind === "guide" ? "article" : "website",
    published: page.published,
    modified: page.updated,
    image: ogImageFor({ key: "default", ogStatic: ogStaticOf(matches) }),
    jsonLd: seoPageJsonLd(page),
  });
}
