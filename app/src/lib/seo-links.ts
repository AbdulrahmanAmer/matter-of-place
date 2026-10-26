import { seoPagePaths } from "../content/seo/meta";
import type { SeoPageContent } from "../content/seo/types";

/**
 * The inline links of the search pages in `src/content/seo`. Only the page component uses this file, and it reads the
 * light list of addresses, never the copy of another page. `seo-page.ts` builds the head and is loaded with every
 * route, so nothing here belongs in it.
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
  path === "/guides" || servedStaticPaths.has(path) || seoPagePaths.has(path);

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
