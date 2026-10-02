import { properties } from "../../data/properties";
import type { Property } from "../../domain/property";
import { designFeatureNames, designFeatures } from "../../lib/catalog";
import type { SearchMatch, SearchService } from "../types";

/**
 * Keyword matcher for the home finder. Reads the visitor's words and ranks
 * properties by type, architecture, features, place, budget and bedrooms.
 * The `http` adapter replaces this with a model-backed ranking; the
 * interface and the UI stay the same.
 */
const synonyms: Record<string, RegExp> = {
  "Mid-century": /mid[- ]?century|midcentury|post[- ]and[- ]beam|eichler|60s|1960/i,
  Modern: /\bmodern\b|minimal/i,
  Contemporary: /contemporary|new build|recent/i,
  Edwardian: /edwardian|victorian|period|historic|old house/i,
  "Mediterranean Revival": /mediterranean|spanish|tuscan|villa/i,
  "Greek Revival": /greek revival|federal|townhouse/i,
  Italianate: /italianate|brownstone/i,
  "Shingle Style": /shingle|cedar|hamptons/i,
  Views: /view|overlook|vista/i,
  Terraces: /terrace|deck|balcon|outdoor/i,
  Garden: /garden|yard|trees|oak|green/i,
  Pool: /pool|swim/i,
  Courtyard: /courtyard/i,
  "Original details": /original|restored|character|period/i,
  "Natural materials": /stone|timber|wood|concrete|natural material/i,
  Waterfront: /water|ocean|beach|bay|sea|coast/i,
};

const budgetFrom = (text: string): number | null => {
  const match = text.match(
    /(?:under|below|up to|max(?:imum)?|budget(?: of)?|less than)?\s*\$?\s*(\d+(?:\.\d+)?)\s*(m|million|k)\b/i,
  );
  if (!match) return null;
  const amount = parseFloat(match[1] ?? "0");
  return /k/i.test(match[2] ?? "") ? amount * 1e3 : amount * 1e6;
};

const bedroomsFrom = (text: string) =>
  Number(text.match(/(\d)\s*(?:\+\s*)?(?:bed|bedroom|br)/i)?.[1] ?? 0);

const scoreProperty = (property: Property, text: string): SearchMatch => {
  const lower = text.toLowerCase();
  const reasons: string[] = [];
  let score = 0;

  if (lower.includes(property.type.toLowerCase())) {
    score += 3;
    reasons.push(property.type);
  }
  if (lower.includes(property.style.toLowerCase()) || synonyms[property.style]?.test(text)) {
    score += 3;
    reasons.push(property.style);
  }

  const features = designFeatures(property);
  for (const feature of designFeatureNames) {
    if (features.includes(feature) && synonyms[feature]?.test(text)) {
      score += 2;
      reasons.push(feature);
    }
  }

  const places = [
    property.city,
    property.neighborhood,
    property.state,
    property.region.replace(/-/g, " "),
  ];
  const place = places.find((name) => lower.includes(name.toLowerCase()));
  if (place) {
    score += 3;
    reasons.push(place);
  }

  const budget = budgetFrom(text);
  if (budget !== null) {
    if (property.price <= budget) {
      score += 1;
      reasons.push("Within budget");
    } else {
      score -= 4;
    }
  }

  const beds = bedroomsFrom(text);
  if (beds > 0) {
    if (property.beds >= beds) {
      score += 1;
      reasons.push(`${String(beds)}+ bedrooms`);
    } else {
      score -= 2;
    }
  }

  return { property, score, reasons };
};

const matchProperties = (list: Property[], text: string, limit: number): SearchMatch[] =>
  list
    .map((property) => scoreProperty(property, text))
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

export const localSearch: SearchService = {
  match: ({ text, limit = 6 }) => Promise.resolve(matchProperties(properties, text, limit)),
};
