import { absoluteUrl, siteConfig } from "../config/site";

type OpenGraphType = "website" | "article";

type JsonLdObject = Record<string, unknown>;

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
};

const suffix = ` | ${siteConfig.name}`;

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
}: PageHeadInput) {
  // The brand appears exactly once. Routes pass bare titles; the home route passes a title
  // that starts with the brand, and the root passes the brand alone (GOTCHAS G-003).
  const hasBrand =
    title === siteConfig.name ||
    title.startsWith(`${siteConfig.name} | `) ||
    title.endsWith(suffix);
  const fullTitle = hasBrand ? title : `${title}${suffix}`;
  const canonical = absoluteUrl(canonicalPath(path));
  const shownImage = image !== undefined && hasAbsoluteHttpsUrl(image) ? image : undefined;
  const graph = Array.isArray(jsonLd)
    ? { "@context": "https://schema.org", "@graph": jsonLd }
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
      ...(noindex ? [{ name: "robots", content: "noindex, nofollow" }] : []),
    ],
    links: [{ rel: "canonical", href: canonical }],
    scripts: graph
      ? [{ type: "application/ld+json", children: serializeJsonForScript(graph) }]
      : [],
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
