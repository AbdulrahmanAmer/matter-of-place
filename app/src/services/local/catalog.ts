import { markets } from "../../data/markets";
import { properties } from "../../data/properties";
import { stories } from "../../data/stories";
import type { CatalogService } from "../types";

/** Display order of the three desks. */
const marketOrder = ["california", "new-york", "florida"];

/** Catalog served from the content modules in `src/data`. */
export const localCatalog: CatalogService = {
  async listProperties() {
    return properties;
  },
  async getProperty(slug) {
    return properties.find((property) => property.slug === slug) ?? null;
  },
  async listMarkets() {
    return [...markets].sort((a, b) => marketOrder.indexOf(a.slug) - marketOrder.indexOf(b.slug));
  },
  async getMarket(slug) {
    return markets.find((market) => market.slug === slug) ?? null;
  },
  async listStories() {
    return stories;
  },
  async getStory(slug) {
    return stories.find((story) => story.slug === slug) ?? null;
  },
};
