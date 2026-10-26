import type { Article, Service } from "schema-dts";
import { absoluteUrl, siteConfig } from "../config/site";
import type { SeoPageContent } from "../content/seo/types";
import { breadcrumbLd, type Crumb } from "./jsonld";
import { ogImageFor, ogStaticOf } from "./og";
import { faqJsonLd, pageHead, unavailableHead } from "./seo";

/**
 * The head and structured data of the search pages in `src/content/seo`. Every route file imports this, so it holds no
 * copy and imports no page: a route loads its page and passes it in. A page is static content: nothing here reads a
 * table, so a warm request costs no query (architecture 13). The inline links live in `seo-links.ts`.
 */

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

/** The `head()` of a search page, from its content alone; a route whose loader found no page gets the noindex head. */
export function seoPageHead(
  page: SeoPageContent | undefined,
  matches: Parameters<typeof ogStaticOf>[0],
) {
  if (page === undefined) return unavailableHead("Page");
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
