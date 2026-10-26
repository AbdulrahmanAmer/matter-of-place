/**
 * The shape of one search page (a collection guide or an article guide). A page is one file in this folder that
 * exports a `SeoPageContent`; `index.ts` lists it. Copy follows the brand rules: calm, brief, specific, no em
 * dashes, no promise of leads, buyers or sales, California, New York and Florida only, and no home described as if it
 * were listed (production shows no illustrative property, ever).
 *
 * An inline link inside a paragraph or a list item is written `[anchor](/path)`. A link to a path no page serves yet
 * renders as its plain anchor text, so a page can name a sibling before the sibling exists.
 */

/** A paragraph (a string), a sub-heading, a bulleted list or a numbered list. */
export type SeoBlock = string | { h3: string } | { list: string[] } | { steps: string[] };

/** The two buttons a page may end on, by key; the label and address of each live in `components/site/seo-page.tsx`. */
export type SeoCtaKey = "submit" | "notes" | "contact";

export interface SeoPageContent {
  /** The public address: no trailing slash, `/<slug>` for a collection guide, `/guides/<slug>` for an article guide. */
  path: string;
  /** `collection` is editorial about a kind of home; `guide` is an article. A guide must live under `/guides/`. */
  kind: "collection" | "guide";
  /** The primary query the page answers. The H1 and the first paragraph carry it. */
  query: string;
  /** The title before the site name; the head adds ` | Matter of Place`. */
  title: string;
  h1: string;
  /** The meta description, 70 to 155 characters. */
  description: string;
  /** The small capitals line above the H1. */
  eyebrow: string;
  /** The first paragraph: it answers the query in plain words. */
  lede: string;
  /** The H2 sections before the questions, in the order of the brief's outline. */
  sections: { heading: string; body: SeoBlock[] }[];
  /** Rendered under the H2 "Frequently asked questions". */
  faq: { q: string; a: string }[];
  /** Links the brief names, with their exact anchors. Only those a page serves are drawn. */
  related: { to: string; anchor: string }[];
  /** The closing section: its H2, a sentence, the main button and an optional second one. */
  cta: { heading: string; text: string; primary: SeoCtaKey; secondary?: SeoCtaKey };
  /** The structured data written for the page, besides the breadcrumb and the web page node. */
  schema: ("Article" | "Service" | "FAQPage")[];
  /** The day the page was first published, `YYYY-MM-DD`. A content date, never the build clock. */
  published: string;
  /** The day the copy last changed, `YYYY-MM-DD`; the sitemap's `lastmod` and the JSON-LD `dateModified`. */
  updated: string;
}
