import { markets } from "../../data/markets";
import { properties } from "../../data/properties";
import { stories } from "../../data/stories";
import { pickCard } from "../../lib/property-card";
import type { CatalogService } from "../types";

/** Display order of the three desks. */
const marketOrder = ["california", "new-york", "florida"];

/** Catalog served from the content modules in `src/data`. */
export const localCatalog: CatalogService = {
  listProperties: () => Promise.resolve(properties.map(pickCard)),
  getProperty: (slug) =>
    Promise.resolve(properties.find((property) => property.slug === slug) ?? null),
  listMarkets: () =>
    Promise.resolve(
      [...markets].sort((a, b) => marketOrder.indexOf(a.slug) - marketOrder.indexOf(b.slug)),
    ),
  getMarket: (slug) => Promise.resolve(markets.find((market) => market.slug === slug) ?? null),
  listStories: () => Promise.resolve(stories),
  getStory: (slug) => Promise.resolve(stories.find((story) => story.slug === slug) ?? null),
};
