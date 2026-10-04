import { properties } from "../../data/properties";
import { matchProperties } from "../../lib/search-match";
import type { SearchService } from "../types";

export const localSearch: SearchService = {
  match: ({ text, limit = 6 }) => Promise.resolve(matchProperties(properties, text, limit)),
};
