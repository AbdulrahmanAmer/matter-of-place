import { absoluteUrl, siteConfig } from "../config/site";
import type { SiteSettings } from "../domain/settings";

type OpenGraphType = "website" | "article";

type JsonLdObject = object;

type PageImage = {
  /** Absolute `https` URL. A relative path is dropped: social crawlers reject it. */
  url: string;
  width: number;
  height: number;
  alt: string;
};

export type PageHeadInput = {
  /** Page title without the site suffix. */
  title: string;
  description: string;
  /** Site path, used for the canonical link. */
  path: string;
  type?: OpenGraphType;
  image?: PageImage;
  /** ISO date, written as `article:published_time` for `type: "article"`. */
  published?: string;
  /** ISO date, written as `article:modified_time` for `type: "article"`. */
  modified?: string;
  /** One object, or an array that becomes one `@graph`. */
  jsonLd?: JsonLdObject | JsonLdObject[];
  noindex?: boolean;
  /** From `indexable(count)`: a page that stays out of the index but lets crawlers follow its links. */
  robots?: "noindex, follow";
};

/**
 * The one writer of a structured-data script body (SEC-03). Titles and stories arrive from the public
 * submission form, so `<`, `>` and `&` are escaped, which keeps a payload from closing its own script
 * element, and so are the two line separators. Every escape is valid JSON: `JSON.parse` reads the original.
 */
export function serializeJsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(
    /[<>&\u2028\u2029]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

/** The path without query, fragment or trailing slash; the home path stays `/`. */
function canonicalPath(path: string): string {
  const bare = path.split(/[?#]/, 1)[0] ?? "";
  const trimmed = bare.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}

function hasAbsoluteHttpsUrl({ url }: PageImage): boolean {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

type Node = Record<string, unknown>;

/** A FAQ page has no builder that knows its address, so its node takes the page's `#primary` id here. */
function withPrimaryId(nodes: JsonLdObject[], canonical: string): JsonLdObject[] {
  return nodes.map((node) =>
    (node as Node)["@type"] === "FAQPage" && (node as Node)["@id"] === undefined
      ? { "@id": `${canonical}#primary`, ...node }
      : node,
  );
}

/** The page itself, tying its breadcrumb and main entity to the site (SCH-001). */
function webPageNode(
  page: { canonical: string; title: string; description: string },
  nodes: JsonLdObject[],
) {
  const has = (id: string) => nodes.some((node) => (node as Node)["@id"] === id);
  const link = (id: string) => (has(id) ? { "@id": id } : undefined);
  const breadcrumb = link(`${page.canonical}#breadcrumb`);
  const mainEntity = link(`${page.canonical}#primary`);
  return {
    "@type": "WebPage",
    "@id": `${page.canonical}#webpage`,
    url: page.canonical,
    name: page.title,
    description: page.description,
    isPartOf: { "@id": absoluteUrl("/#website") },
    ...(breadcrumb === undefined ? {} : { breadcrumb }),
    ...(mainEntity === undefined ? {} : { mainEntity }),
  };
}

/**
 * Builds the `head()` return value for a route: unique title and description,
 * Open Graph and Twitter tags, a canonical link and optional JSON-LD. An image
 * is written only when its URL is absolute and `https`; bundled assets resolve
 * to relative paths, which social crawlers reject.
 */
export function pageHead({
  title,
  description,
  path,
  type = "website",
  image,
  published,
  modified,
  jsonLd,
  noindex,
  robots,
}: PageHeadInput) {
  // The brand appears exactly once. Routes pass bare titles; the home route passes a title
  // that starts with the brand, and the root passes the brand alone (GOTCHAS G-003).
  const suffix = ` | ${siteConfig.name}`;
  const hasBrand =
    title === siteConfig.name ||
    title.startsWith(`${siteConfig.name} | `) ||
    title.endsWith(suffix);
  const fullTitle = hasBrand ? title : `${title}${suffix}`;
  const canonical = absoluteUrl(canonicalPath(path));
  const shownImage = image !== undefined && hasAbsoluteHttpsUrl(image) ? image : undefined;
  const nodes = Array.isArray(jsonLd) ? withPrimaryId(jsonLd, canonical) : [];
  const graph = Array.isArray(jsonLd)
    ? {
        "@context": "https://schema.org",
        "@graph": [webPageNode({ canonical, title: fullTitle, description }, nodes), ...nodes],
      }
    : jsonLd;
  return {
    meta: [
      { title: fullTitle },
      { name: "description", content: description },
      { property: "og:title", content: fullTitle },
      { property: "og:description", content: description },
      { property: "og:type", content: type },
      { property: "og:url", content: canonical },
      { property: "og:site_name", content: siteConfig.name },
      { property: "og:locale", content: siteConfig.locale.replace("-", "_") },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: fullTitle },
      { name: "twitter:description", content: description },
      ...(shownImage
        ? [
            { property: "og:image", content: shownImage.url },
            { property: "og:image:width", content: String(shownImage.width) },
            { property: "og:image:height", content: String(shownImage.height) },
            { property: "og:image:alt", content: shownImage.alt },
            { name: "twitter:image", content: shownImage.url },
          ]
        : []),
      ...(type === "article" && published
        ? [{ property: "article:published_time", content: published }]
        : []),
      ...(type === "article" && modified
        ? [{ property: "article:modified_time", content: modified }]
        : []),
      ...(noindex
        ? [{ name: "robots", content: "noindex, nofollow" }]
        : robots === undefined
          ? []
          : [{ name: "robots", content: robots }]),
    ],
    links: [{ rel: "canonical", href: canonical }],
    scripts: graph
      ? [{ type: "application/ld+json", children: serializeJsonForScript(graph) }]
      : [],
  };
}

/**
 * A market, region or `/properties` page with no published property is a thin page: `noindex, follow` and
 * absent from the sitemap while empty, indexed once the first property is published (invariant 3). The head
 * and `buildSitemap` both read the answer, so the two cannot disagree.
 */
export function indexable(count: number): { robots?: "noindex, follow" } {
  return count === 0 ? { robots: "noindex, follow" } : {};
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
  "@type": "FAQPage",
  mainEntity: items.map((item) => ({
    "@type": "Question",
    name: item.q,
    acceptedAnswer: { "@type": "Answer", text: item.a },
  })),
});

/**
 * The business as structured data. Only what `settings.site` holds appears: an unset leaf adds no key, and `sameAs`
 * is absent when no social address is set. The parent is Omnikom (S33) whatever the settings say. The logo is the
 * brand emblem served from `public/`, so a search for the name finds one unambiguous organization (2026-10-19).
 */
/** The brand emblem at 512 px square, the size search engines accept for an organization's logo. */
export const LOGO_PATH = "/icon-512.png";

export function organizationJsonLd({ contact, legal, social }: SiteSettings) {
  const sameAs = [social.instagram, social.x, social.linkedin].filter(
    (value): value is string => value !== null,
  );
  const address =
    legal.address === null ? null : { "@type": "PostalAddress", streetAddress: legal.address };
  return {
    "@type": "Organization",
    "@id": absoluteUrl("/#organization"),
    name: siteConfig.name,
    url: siteConfig.url,
    description: siteConfig.description,
    logo: { "@type": "ImageObject", url: absoluteUrl(LOGO_PATH), width: 512, height: 512 },
    ...(legal.entity === null ? {} : { legalName: legal.entity }),
    ...(contact.email === null ? {} : { email: contact.email }),
    ...(contact.phone === null ? {} : { telephone: contact.phone }),
    ...(address === null ? {} : { address }),
    ...(sameAs.length === 0 ? {} : { sameAs }),
    parentOrganization: { "@type": "Organization", name: siteConfig.parentCompany },
  };
}
