import {
  archiveKinds,
  type ArchiveKind,
  type Facet,
  type FacetMap,
  type FacetSummary,
} from "../../domain/archive.ts";
import type { PropertyCard } from "../../domain/property.ts";
import { slugify } from "../../lib/slug.ts";
import type { PublicState, ServedCatalog } from "../public/state.ts";

/**
 * Archive pages for a city, an architect or a style, derived in memory from the catalog snapshot (architecture 13
 * rule 1): no query, grouped once per catalog version. A facet exists when `MIN_ARCHIVE` published properties share
 * it and the `archive_pages` flag is on. `archive_facets` in `<ts>_archive_facets.sql` states the same threshold.
 */
export const MIN_ARCHIVE = 3;

type Source = Pick<ServedCatalog, "properties" | "cards">;

interface Group extends FacetSummary {
  slugs: string[];
  labels: Set<string>;
}

interface Grouped {
  groups: Group[];
  cards: Map<string, PropertyCard>;
}

const STATE_SLUGS: Record<string, string> = { California: "ca", "New York": "ny", Florida: "fl" };

// The served catalog is one object per version, so its entry lives exactly as long as the version does.
const memo = new WeakMap<Source, Grouped>();

function group(source: Source): Grouped {
  const known = memo.get(source);
  if (known !== undefined) return known;
  const found = new Map<string, Group>();
  const add = (kind: ArchiveKind, label: string, text: string, property: string): void => {
    const slug = slugify(text);
    if (slug === "") return;
    const key = `${kind}/${slug}`;
    const current = found.get(key) ?? { kind, slug, label, count: 0, slugs: [], labels: new Set() };
    current.label = label < current.label ? label : current.label;
    current.labels.add(label);
    current.count += 1;
    current.slugs.push(property);
    found.set(key, current);
  };
  for (const property of source.properties) {
    const state = STATE_SLUGS[property.state] ?? property.state;
    add("city", `${property.city}, ${property.state}`, `${property.city} ${state}`, property.slug);
    if (property.architect !== undefined)
      add("architect", property.architect, property.architect, property.slug);
    add("style", property.style, property.style, property.slug);
  }
  const grouped = {
    groups: [...found.values()].filter(({ count }) => count >= MIN_ARCHIVE),
    cards: new Map(source.cards.map((card) => [card.slug, card])),
  };
  memo.set(source, grouped);
  return grouped;
}

const enabled = (state: PublicState): boolean => state.flags["archive_pages"] === true;

const byKindThenSlug = (a: FacetSummary, b: FacetSummary): number =>
  archiveKinds.indexOf(a.kind) - archiveKinds.indexOf(b.kind) ||
  (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0);

/** Every facet that has an archive page, whatever its kind; none while the flag is off. */
export function listFacets(source: Source, state: PublicState): FacetSummary[] {
  if (!enabled(state)) return [];
  return group(source)
    .groups.map(({ kind, slug, label, count }) => ({ kind, slug, label, count }))
    .sort(byKindThenSlug);
}

/** One archive page, its properties as the list cards of the catalog, or null below the threshold or with the flag off. */
export function getFacet(
  source: Source,
  state: PublicState,
  kind: ArchiveKind,
  slug: string,
): Facet | null {
  if (!enabled(state)) return null;
  const { groups, cards } = group(source);
  const found = groups.find((candidate) => candidate.kind === kind && candidate.slug === slug);
  if (found === undefined) return null;
  return {
    kind,
    slug,
    label: found.label,
    count: found.count,
    items: found.slugs.flatMap((property) => cards.get(property) ?? []),
  };
}

/**
 * `{ <kind>: { <label>: <slug> } }` for the facets that exist: what a property page needs to link to an archive. Every
 * spelling that folds into a facet is a key, so a property whose label differs only in case or accents still links.
 */
export function facetMap(source: Source, state: PublicState): FacetMap {
  const map: FacetMap = { city: {}, architect: {}, style: {} };
  if (!enabled(state)) return map;
  for (const { kind, slug, labels } of group(source).groups)
    for (const label of labels) map[kind][label] = slug;
  return map;
}

/** The address of the archive page for a label, or null when it does not exist. */
export function archiveHref(
  source: Source,
  state: PublicState,
  kind: ArchiveKind,
  label: string,
): string | null {
  const slug = facetMap(source, state)[kind][label];
  return slug === undefined ? null : `/archive/${kind}/${slug}`;
}
