import type { PropertyCard } from "../domain/property";
import { designFeatureNames, designFeatures } from "./catalog";

export interface Scored<T> {
  property: T;
  score: number;
  reasons: string[];
}

/**
 * Keyword matcher for the home finder. Reads the visitor's words and ranks
 * properties by type, architecture, features, place, budget and bedrooms.
 * It reads card fields only (PERF-06), so the local adapter and the Worker
 * rank the same way over the same cards.
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

// The words before an amount ("under", "up to", "budget of") and a "$" change nothing the amount is read
// from, so the pattern starts at the digits: two adjacent `\s*` in front of them backtracked on a long
// run of spaces (security scan F2, P-3101).
const budgetFrom = (text: string): number | null => {
  const match = text.match(/(\d+(?:\.\d+)?)\s*(m|million|k)\b/i);
  if (!match) return null;
  const amount = parseFloat(match[1] ?? "0");
  return /k/i.test(match[2] ?? "") ? amount * 1e3 : amount * 1e6;
};

const bedroomsFrom = (text: string) =>
  Number(text.match(/(\d)\s*(?:\+\s*)?(?:bed|bedroom|br)/i)?.[1] ?? 0);

/** What the visitor's words say, read once per request and shared by every card. */
interface Reading {
  text: string;
  lower: string;
  budget: number | null;
  beds: number;
}

const readQuery = (query: string): Reading => {
  const text = query.replace(/\s+/g, " ").trim();
  return { text, lower: text.toLowerCase(), budget: budgetFrom(text), beds: bedroomsFrom(text) };
};

const scoreProperty = <T extends PropertyCard>(
  property: T,
  { text, lower, budget, beds }: Reading,
): Scored<T> => {
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

  if (budget !== null) {
    if (property.price <= budget) {
      score += 1;
      reasons.push("Within budget");
    } else {
      score -= 4;
    }
  }

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

export const matchProperties = <T extends PropertyCard>(
  list: T[],
  text: string,
  limit: number,
): Scored<T>[] => {
  const reading = readQuery(text);
  return list
    .map((property) => scoreProperty(property, reading))
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
};
