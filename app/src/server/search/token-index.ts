import type { Property } from "../../domain/property";

/** The mapped fields the index reads. */
export type Indexed = Pick<
  Property,
  "slug" | "title" | "architect" | "designer" | "place" | "city" | "neighborhood" | "address"
>;

// The free-text half of `POST /search` (GD-08): a token index over the mapped text fields of the visible
// properties, built in the Worker, never in the database. Tokens are lower case, without accents or punctuation,
// and plurals are folded on both sides, so "houses" finds "house" and the reverse (F25 g).

export type TextField = "Title" | "Architect" | "Designer" | "Place" | "Address";

export interface TokenIndex {
  entries: { slug: string; fields: Map<TextField, string[]> }[];
}

export interface TokenHit {
  slug: string;
  /** How many distinct query tokens found a token of this property. */
  hits: number;
  /** The fields that held a hit, in the order of `TextField`. */
  fields: TextField[];
}

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "at",
  "for",
  "in",
  "of",
  "on",
  "or",
  "the",
  "to",
  "under",
  "with",
]);
const FIELD_ORDER: TextField[] = ["Title", "Architect", "Designer", "Place", "Address"];
const MIN_PREFIX = 3;

/** One plural folded away: "houses" and "house" are one token, "glass" stays. */
function fold(token: string): string {
  if (token.length <= 3) return token;
  if (token.endsWith("ies")) return `${token.slice(0, -3)}y`;
  if (/(?:ss|us|is)$/.test(token)) return token;
  if (/(?:sses|ches|shes|xes|zes)$/.test(token)) return token.slice(0, -2);
  return token.endsWith("s") ? token.slice(0, -1) : token;
}

/** Lower-cased, accent-free, punctuation-free words, folded, without the words that carry no meaning. */
export function tokenize(text: string): string[] {
  const words = text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== "" && !STOPWORDS.has(word));
  return [...new Set(words.map(fold))];
}

/** The text of each field the index holds, as the mapped property carries it. */
function fieldsOf(property: Indexed): [TextField, string][] {
  return [
    ["Title", property.title],
    ["Architect", property.architect ?? ""],
    ["Designer", property.designer ?? ""],
    ["Place", [property.place, property.city, property.neighborhood].join(" ")],
    ["Address", property.address],
  ];
}

export function buildTokenIndex(properties: readonly Indexed[]): TokenIndex {
  return {
    entries: properties.map((property) => ({
      slug: property.slug,
      fields: new Map(fieldsOf(property).map(([field, text]) => [field, tokenize(text)])),
    })),
  };
}

const found = (query: string, token: string): boolean =>
  token === query || (query.length >= MIN_PREFIX && token.startsWith(query));

/** Every property with at least one query token in a field, with how many tokens and in which fields. */
export function lookup(index: TokenIndex, text: string): TokenHit[] {
  const query = tokenize(text);
  return index.entries.flatMap(({ slug, fields }) => {
    const hit = new Set<string>();
    const where = new Set<TextField>();
    for (const [field, tokens] of fields) {
      for (const word of query) {
        if (tokens.some((token) => found(word, token))) {
          hit.add(word);
          where.add(field);
        }
      }
    }
    return hit.size === 0
      ? []
      : [{ slug, hits: hit.size, fields: FIELD_ORDER.filter((field) => where.has(field)) }];
  });
}
