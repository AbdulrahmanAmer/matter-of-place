import type { Property, PropertyCard } from "../domain/property.ts";

/**
 * The one place that decides what a list card holds (PERF-06). The Worker maps the catalog once per version
 * through it and the local adapter serves the bundled properties through it, so both modes answer with the
 * same cards. An unset optional field stays absent: a card is sent as JSON.
 */
export function pickCard(property: Property): PropertyCard {
  const { architect, heroRank, featuredRank, heroVariants } = property;
  return {
    slug: property.slug,
    title: property.title,
    market: property.market,
    region: property.region,
    city: property.city,
    neighborhood: property.neighborhood,
    state: property.state,
    type: property.type,
    style: property.style,
    status: property.status,
    price: property.price,
    currency: property.currency,
    beds: property.beds,
    baths: property.baths,
    interiorSqFt: property.interiorSqFt,
    publishedAt: property.publishedAt,
    features: property.features,
    heroImage: property.heroImage,
    ...(architect !== undefined && { architect }),
    ...(heroRank !== undefined && { heroRank }),
    ...(featuredRank !== undefined && { featuredRank }),
    ...(heroVariants?.card !== undefined && { heroVariants: { card: heroVariants.card } }),
  };
}
