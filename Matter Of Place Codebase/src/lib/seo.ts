import { absoluteUrl, siteConfig } from "../config/site";

type OpenGraphType = "website" | "article";

export type PageHeadInput = {
  /** Page title without the site suffix. */
  title: string;
  description: string;
  /** Site path, used for the canonical link. */
  path: string;
  type?: OpenGraphType;
  /** Structured data rendered as JSON-LD. */
  jsonLd?: Record<string, unknown>;
  noindex?: boolean;
};

const suffix = ` | ${siteConfig.name}`;

/**
 * Builds the `head()` return value for a route: unique title and description,
 * Open Graph and Twitter tags, a canonical link and optional JSON-LD.
 * Image tags are intentionally omitted; bundled assets resolve to relative
 * paths, which social crawlers reject.
 */
export function pageHead({
  title,
  description,
  path,
  type = "website",
  jsonLd,
  noindex,
}: PageHeadInput) {
  const fullTitle = title.endsWith(suffix) ? title : `${title}${suffix}`;
  return {
    meta: [
      { title: fullTitle },
      { name: "description", content: description },
      { property: "og:title", content: fullTitle },
      { property: "og:description", content: description },
      { property: "og:type", content: type },
      { property: "og:url", content: absoluteUrl(path) },
      { name: "twitter:card", content: "summary_large_image" },
      ...(noindex ? [{ name: "robots", content: "noindex, nofollow" }] : []),
    ],
    links: [{ rel: "canonical", href: absoluteUrl(path) }],
    scripts: jsonLd ? [{ type: "application/ld+json", children: JSON.stringify(jsonLd) }] : [],
  };
}

/** Head for a dynamic route whose loader did not resolve (not found or failed). */
export const unavailableHead = (noun: string) =>
  pageHead({
    title: `${noun} unavailable`,
    description: `This ${noun.toLowerCase()} could not be found.`,
    path: "/",
    noindex: true,
  });

export const faqJsonLd = (items: { q: string; a: string }[]) => ({
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: items.map((item) => ({
    "@type": "Question",
    name: item.q,
    acceptedAnswer: { "@type": "Answer", text: item.a },
  })),
});
