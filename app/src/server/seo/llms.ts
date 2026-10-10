import { absoluteUrl, siteConfig } from "../../config/site.ts";
import type { FacetSummary } from "../../domain/archive.ts";
import type { Market } from "../../domain/market.ts";
import type { Property } from "../../domain/property.ts";
import type { Story } from "../../domain/story.ts";
import { formatNumber, pluralize } from "../../lib/format.ts";
import { indexable } from "../../lib/seo.ts";
import {
  archiveDescription,
  marketDescription,
  marketGuideDescription,
  pageDescription,
  propertyDescription,
  storyDescription,
  type PageDescriptionKey,
} from "../../lib/seo-copy.ts";
import { loadRedirectMap } from "../public/redirects.ts";
import type { PublicState, ServedCatalog } from "../public/state.ts";
import { listFacets } from "./archive.ts";

/**
 * `llms.txt` and `llms-full.txt`, pure functions over the output of `getCatalog` and `getPublicState` (architecture 13
 * rule 1): no client, no query. They list what the sitemap lists and leave out what it leaves out: a taken-down
 * property, an address that answers a redirect, an empty market and an archive below its threshold. Locations stay at
 * city level and no contact detail of a representative is written.
 */
export const MAX_BYTES = 500 * 1024;
export const NO_PROPERTIES_SENTENCE = "No properties are published yet.";

type Source = Pick<
  ServedCatalog,
  "properties" | "markets" | "stories" | "cards" | "redirects" | "slugHistory" | "gone"
>;

// The pages worth reading for a model, with the key of the description each one carries as its meta description.
const pages = [
  ["/properties", "Properties", "properties"],
  ["/markets", "Markets", "markets.index"],
  ["/stories", "Stories", "stories.index"],
  ["/editorial-standard", "Editorial standard", "editorial-standard"],
  ["/exposure", "Exposure", "exposure"],
  ["/submit", "Submit a property", "submit"],
  ["/about", "About", "about"],
  ["/faq", "Questions", "faq"],
  ["/contact", "Contact", "contact"],
] as const satisfies readonly (readonly [string, string, PageDescriptionKey])[];

export const llmsPaths: readonly string[] = pages.map(([path]) => path);

interface Listed {
  pages: { path: string; name: string; description: string }[];
  markets: { market: Market; path: string; description: string }[];
  properties: Property[];
  stories: Story[];
  facets: (FacetSummary & { path: string })[];
}

/** Brackets are escaped so that free text from a submission can never form a link of its own. */
const plain = (value: string): string =>
  value.replace(/\s+/g, " ").trim().replace(/[[\]]/g, "\\$&");

/** A headline ends in a full stop; a name in a link, as in a page title, does not. */
const headline = (title: string): string => title.replace(/\.$/, "");

const link = (name: string, path: string): string => `[${plain(name)}](${absoluteUrl(path)})`;

function listed(source: Source, state: PublicState): Listed {
  const taken = new Set(source.gone);
  const redirected = loadRedirectMap(source);
  const open = (path: string): boolean => !redirected.has(path);
  const properties = source.properties.filter(
    ({ slug }) => !taken.has(slug) && open(`/property/${slug}`),
  );
  const inMarket = (slug: string): number =>
    properties.filter((property) => property.market === slug).length;
  return {
    pages: pages
      .filter(
        ([path]) => path !== "/properties" || indexable(properties.length).robots === undefined,
      )
      .filter(([path]) => open(path))
      .map(([path, name, key]) => ({ path, name, description: pageDescription(key) })),
    markets: source.markets.map((market) => {
      const hasProperties = inMarket(market.slug) > 0;
      return {
        market,
        path: hasProperties ? `/${market.slug}` : `/${market.slug}/guide`,
        description: hasProperties ? marketDescription(market) : marketGuideDescription(market),
      };
    }),
    properties,
    stories: source.stories.filter(({ slug }) => open(`/stories/${slug}`)),
    facets: listFacets(source, state)
      .map((facet) => ({ ...facet, path: `/archive/${facet.kind}/${facet.slug}` }))
      .filter(({ path }) => open(path)),
  };
}

interface Section {
  heading: string;
  entries: string[];
  /** What separates two entries: a line break for a list, a blank line for entries of several lines. */
  gap: "\n" | "\n\n";
}

const encoder = new TextEncoder();
const bytes = (text: string): number => encoder.encode(text).length;

const truncatedLine = (missing: number): string =>
  `List truncated: ${String(missing)} more ${pluralize(missing, "entry", "entries")}. Every page is listed at ${absoluteUrl("/sitemap.xml")}.`;

/**
 * The document, cut at an entry when it would pass `maxBytes`: the entries after the cut are dropped whole, and a
 * line says that the list was truncated and how many entries were left out.
 */
function assemble(head: string, sections: Section[], maxBytes: number): string {
  const blocks = sections
    .filter(({ entries }) => entries.length > 0)
    .flatMap(({ heading, entries, gap }) =>
      entries.map((entry, at) => (at === 0 ? `\n\n## ${heading}\n\n${entry}` : `${gap}${entry}`)),
    );
  const whole = blocks.reduce((sum, block) => sum + bytes(block), bytes(head) + 1);
  if (whole <= maxBytes) return `${head}${blocks.join("")}\n`;
  const reserve = bytes(`\n\n${truncatedLine(blocks.length)}`);
  let used = bytes(head) + 1;
  const kept: string[] = [];
  for (const block of blocks) {
    if (used + bytes(block) + reserve > maxBytes) break;
    kept.push(block);
    used += bytes(block);
  }
  return `${head}${kept.join("")}\n\n${truncatedLine(blocks.length - kept.length)}\n`;
}

const head = (extra: string): string =>
  `# ${siteConfig.name}\n\n> ${siteConfig.description}\n\n${extra}`;

const listItem = (name: string, path: string, description: string): string =>
  `- ${link(name, path)}: ${plain(description)}`;

const propertiesSection = (items: Listed, entry: (property: Property) => string): Section => ({
  heading: "Properties",
  entries: items.properties.length === 0 ? [NO_PROPERTIES_SENTENCE] : items.properties.map(entry),
  gap: "\n",
});

const archivesSection = (items: Listed): Section => ({
  heading: "Archives",
  entries: items.facets.map(({ kind, label, count, path }) =>
    listItem(label, path, archiveDescription(kind, label, count)),
  ),
  gap: "\n",
});

/** The index: one line per page, market, property, story and archive. */
export function buildLlmsTxt(source: Source, state: PublicState, maxBytes = MAX_BYTES): string {
  const items = listed(source, state);
  return assemble(
    head(`The text of every listed page is in ${link("llms-full.txt", "/llms-full.txt")}.`),
    [
      {
        heading: "Pages",
        entries: items.pages.map(({ path, name, description }) =>
          listItem(name, path, description),
        ),
        gap: "\n",
      },
      {
        heading: "Markets",
        entries: items.markets.map(({ market, path, description }) =>
          listItem(market.name, path, description),
        ),
        gap: "\n",
      },
      propertiesSection(items, (property) =>
        listItem(
          `${headline(property.title)}, ${property.city}`,
          `/property/${property.slug}`,
          propertyDescription(property),
        ),
      ),
      {
        heading: "Stories",
        entries: items.stories.map((story) =>
          listItem(headline(story.title), `/stories/${story.slug}`, storyDescription(story)),
        ),
        gap: "\n",
      },
      archivesSection(items),
    ],
    maxBytes,
  );
}

function propertyEntry(property: Property): string {
  const facts = [
    `${property.type} in ${property.city}, ${property.state}.`,
    `Style: ${property.style}.`,
    `${String(property.beds)} ${pluralize(property.beds, "bedroom")}, ${String(property.baths)} ${pluralize(property.baths, "bathroom")}, ${formatNumber(property.interiorSqFt)} sq ft, ${formatNumber(property.lotAcres)} ${pluralize(property.lotAcres, "acre")}, built ${String(property.yearBuilt)}.`,
    `Status: ${property.status}.`,
    ...(property.architect === undefined ? [] : [`Architect: ${property.architect}.`]),
    ...(property.designer === undefined ? [] : [`Designer: ${property.designer}.`]),
  ];
  const presented =
    property.representation === undefined
      ? property.presentedByOwner
        ? "Presented by the owner."
        : undefined
      : `Presented by ${property.representation.name}, ${property.representation.brokerage}.`;
  return [
    `### ${link(`${headline(property.title)}, ${property.city}`, `/property/${property.slug}`)}`,
    plain(facts.join(" ")),
    ...property.story.map(plain),
    `Place: ${plain(property.place)}`,
    ...(property.features.length === 0
      ? []
      : [`Features: ${plain(property.features.join(", "))}.`]),
    ...(presented === undefined ? [] : [plain(presented)]),
  ].join("\n\n");
}

const storyEntry = (story: Story): string =>
  [
    `### ${link(headline(story.title), `/stories/${story.slug}`)}`,
    plain(`${story.category}. Published ${story.publishedAt.slice(0, 10)}.`),
    plain(story.deck),
    ...story.body.map(plain),
  ].join("\n\n");

/** The text of every listed property and story, so a model need not fetch each page. */
export function buildLlmsFull(source: Source, state: PublicState, maxBytes = MAX_BYTES): string {
  const items = listed(source, state);
  return assemble(
    head(`The index of these pages is in ${link("llms.txt", "/llms.txt")}.`),
    [
      {
        heading: "Markets",
        entries: items.markets.map(({ market, path }) =>
          [
            `### ${link(market.name, path)}`,
            plain(market.intro),
            `Regions: ${plain(market.regions.map(({ name }) => name).join(", "))}.`,
          ].join("\n\n"),
        ),
        gap: "\n\n",
      },
      { ...propertiesSection(items, propertyEntry), gap: "\n\n" },
      { heading: "Stories", entries: items.stories.map(storyEntry), gap: "\n\n" },
      archivesSection(items),
    ],
    maxBytes,
  );
}
