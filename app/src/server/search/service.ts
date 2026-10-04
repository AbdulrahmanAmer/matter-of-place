import type { z } from "zod";
import type { SearchMatch, searchQuerySchema } from "../../domain/contracts";
import { matchProperties } from "../../lib/search-match";
import type { Db } from "../lib/db";
import { answeredAt } from "../public/post-read";
import { readCatalog, type ServedCatalog } from "../public/state";
import { buildTokenIndex, lookup, type TokenIndex } from "./token-index";

const indexes = new WeakMap<ServedCatalog, TokenIndex>();

/**
 * The token index of this catalog version, built on the first search of the version and kept with it
 * (PERF-03 (3)): `getCatalog` never builds it, so a version bump costs the next page only the snapshot.
 */
export function getSearchIndex(catalog: ServedCatalog): TokenIndex {
  let index = indexes.get(catalog);
  if (index === undefined) {
    index = buildTokenIndex(catalog.properties);
    indexes.set(catalog, index);
  }
  return index;
}

/**
 * `POST /search` (GD-08): the shared matcher over the cards for price, type, style and features, and the token
 * index for the words it does not know (an architect, a designer, a place, a street). The matcher's score ranks
 * first; token hits break a tie and bring in a property the matcher scored nothing. No database call beyond the
 * state check every public read makes.
 */
export async function match(db: Db, input: z.output<typeof searchQuerySchema>): Promise<Response> {
  const { catalog, state } = await readCatalog(db);
  const scored = matchProperties(catalog.cards, input.text, catalog.cards.length);
  const hits = new Map(lookup(getSearchIndex(catalog), input.text).map((hit) => [hit.slug, hit]));
  const scoredSlugs = new Set(scored.map((entry) => entry.property.slug));
  const extra = catalog.cards
    .filter((card) => hits.has(card.slug) && !scoredSlugs.has(card.slug))
    .map((property) => ({ property, score: 0, reasons: [] }));
  const ranked = [...scored, ...extra]
    .map((entry, position) => ({ entry, position, hit: hits.get(entry.property.slug) }))
    .sort(
      (a, b) =>
        b.entry.score - a.entry.score ||
        (b.hit?.hits ?? 0) - (a.hit?.hits ?? 0) ||
        a.position - b.position,
    );
  const answer: SearchMatch[] = ranked.slice(0, input.limit).map(({ entry, hit }) => ({
    ...entry,
    reasons: [...entry.reasons, ...(hit?.fields ?? [])],
  }));
  return answeredAt(answer, state.catalogVersion);
}
