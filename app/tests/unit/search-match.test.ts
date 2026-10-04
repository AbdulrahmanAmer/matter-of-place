import { describe, expect, it } from "vitest";
import { properties } from "../../src/data/properties";
import { pickCard } from "../../src/lib/property-card";
import { matchProperties } from "../../src/lib/search-match";

const cards = properties.map(pickCard);

const QUERIES = [
  "modern house with a pool under 6m",
  "waterfront estate in Florida",
  "4 bedroom brownstone in Brooklyn",
  "mid-century with views and a garden",
  "terrace courtyard original details",
];

const ranked = (
  list: readonly { property: { slug: string }; score: number; reasons: string[] }[],
) => list.map(({ property, score, reasons }) => ({ slug: property.slug, score, reasons }));

describe("matchProperties", () => {
  it.each(QUERIES)("ranks cards as it ranks the full properties: %s", (query) => {
    const fromCards = ranked(matchProperties(cards, query, 6));
    expect(fromCards.length).toBeGreaterThan(0);
    expect(fromCards).toEqual(ranked(matchProperties(properties, query, 6)));
  });

  it("scores a feature found in the card's feature list", () => {
    const [match] = matchProperties(cards, "a house with a pool", 1);
    expect(match?.reasons).toContain("Pool");
  });

  it("keeps the best matches first and honours the limit", () => {
    const [base] = cards.filter((card) => card.features.some((feature) => /pool/i.test(feature)));
    if (base === undefined) throw new Error("no bundled property with a pool");
    const weak = { ...base, slug: "weak", features: [] };
    const list = [weak, base];
    const query = `a house with a pool in ${base.city}`;
    expect(matchProperties(list, query, 6).map((match) => match.property.slug)).toEqual([
      base.slug,
      "weak",
    ]);
    expect(matchProperties(list, query, 1).map((match) => match.property.slug)).toEqual([
      base.slug,
    ]);
  });

  it("leaves out a property that scores nothing", () => {
    expect(matchProperties(cards, "zzzz", 6)).toEqual([]);
  });
});
