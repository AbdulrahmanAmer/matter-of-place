import type { Market, MarketSlug, RegionSlug } from "../domain/market";
import type { Property, PropertyCard } from "../domain/property";
import { formatMoney } from "./format";

/**
 * Pure helpers over catalog data. They take lists as arguments rather than
 * importing content modules, so they work unchanged whether the data comes
 * from `src/data` or from the API. List helpers take the card fields only (PERF-06) and hand back
 * the type they were given, so a list of full properties stays a list of full properties.
 */

export const formatPrice = (property: Pick<Property, "price" | "currency">) =>
  formatMoney(property.price, property.currency);

const byRank = (key: "heroRank" | "featuredRank") => (a: PropertyCard, b: PropertyCard) =>
  (a[key] ?? Number.MAX_SAFE_INTEGER) - (b[key] ?? Number.MAX_SAFE_INTEGER);

/** Properties in the home page opening sequence, in order. */
export const heroProperties = <T extends PropertyCard>(list: T[]) =>
  list.filter((property) => property.heroRank !== undefined).sort(byRank("heroRank"));

/** Properties in the home page "Selected places" grid, in order. */
export const featuredProperties = <T extends PropertyCard>(list: T[]) =>
  list.filter((property) => property.featuredRank !== undefined).sort(byRank("featuredRank"));

export const propertiesIn = <T extends PropertyCard>(
  list: T[],
  market: MarketSlug,
  region?: RegionSlug,
) =>
  list.filter(
    (property) =>
      property.market === market && (region === undefined || property.region === region),
  );

const unique = <T>(values: T[]) => Array.from(new Set(values));

export const typesOf = (list: PropertyCard[]) => unique(list.map((property) => property.type));
export const stylesOf = (list: PropertyCard[]) => unique(list.map((property) => property.style));
export const statusesOf = (list: PropertyCard[]) => unique(list.map((property) => property.status));

/** Design features derived from each dossier's feature list, for filtering and matching. */
const featureRules: [name: string, pattern: RegExp][] = [
  ["Views", /view|outlook|overlook|facing the|glimpse/i],
  ["Terraces", /terrace|deck|loggia|balcon/i],
  ["Garden", /garden|landscap|grove|oaks/i],
  ["Pool", /pool/i],
  ["Courtyard", /courtyard|court/i],
  ["Original details", /original|restored|retained|historic/i],
  ["Natural materials", /stone|timber|lime|concrete|wood|coral/i],
  ["Waterfront", /water|ocean|beach|bay|sea|pacific|dock/i],
];

export const designFeatureNames = featureRules.map(([name]) => name);

export const designFeatures = (property: Pick<PropertyCard, "features">): string[] => {
  const text = property.features.join(" ");
  return featureRules.filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
};

export const featuresOf = (list: PropertyCard[]) => unique(list.flatMap(designFeatures));

/** Related properties: hand-picked first, then same region, then same market, then the rest. */
export const relatedProperties = <T extends PropertyCard>(
  list: T[],
  property: Pick<Property, "slug" | "market" | "region" | "related">,
  count = 3,
): T[] => {
  const bySlug = new Map(list.map((item) => [item.slug, item]));
  const explicit = (property.related ?? [])
    .map((slug) => bySlug.get(slug))
    .filter((item): item is T => item !== undefined);
  const pool = list.filter((item) => item.slug !== property.slug && !explicit.includes(item));
  const sameRegion = pool.filter((item) => item.region === property.region);
  const sameMarket = pool.filter(
    (item) => item.market === property.market && !sameRegion.includes(item),
  );
  const elsewhere = pool.filter((item) => !sameRegion.includes(item) && !sameMarket.includes(item));
  return [...explicit, ...sameRegion, ...sameMarket, ...elsewhere].slice(0, count);
};

export const marketOf = (markets: Market[], slug: MarketSlug) =>
  markets.find((market) => market.slug === slug);

export const regionOf = (markets: Market[], market: MarketSlug, region: RegionSlug) =>
  marketOf(markets, market)?.regions.find((item) => item.slug === region);
