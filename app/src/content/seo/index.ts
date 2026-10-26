import { howToSellAHistoricHome } from "./guides-how-to-sell-a-historic-home.ts";
import { historicHomesForSale } from "./historic-homes-for-sale.ts";
import type { SeoPageContent } from "./types.ts";

/**
 * Every search page, one line each. A writer adds a page here after adding its content file. The order is the order
 * the `/guides` index lists them in. Pages are static content: no loader reads a table for them (architecture 13).
 */
export const seoPages: readonly SeoPageContent[] = [historicHomesForSale, howToSellAHistoricHome];

/** The page served at `path` (no trailing slash), or undefined when none is. */
export function seoPageAt(path: string): SeoPageContent | undefined {
  return seoPages.find((page) => page.path === path);
}

/** The page a route file serves: a missing one is a coding error, so the module fails to load instead of answering 404. */
export function requireSeoPage(path: string): SeoPageContent {
  const page = seoPageAt(path);
  if (page === undefined) throw new Error(`no page in src/content/seo serves ${path}`);
  return page;
}

/** The article guide at `/guides/<slug>`, or undefined. */
export function guidePageAt(slug: string): SeoPageContent | undefined {
  const page = seoPageAt(`/guides/${slug}`);
  return page?.kind === "guide" ? page : undefined;
}
