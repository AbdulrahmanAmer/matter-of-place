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

  it("reads a budget through a dollar sign, spaces and a unit word", () => {
    const [base] = cards;
    if (base === undefined) throw new Error("no bundled property");
    const cheap = { ...base, slug: "cheap", price: 5_000_000 };
    const dear = { ...base, slug: "dear", price: 7_000_000 };
    for (const budget of ["under 6m", "budget of $6.0 million", "$ 6 m", "up to 6000k"]) {
      const scores = new Map(
        matchProperties([cheap, dear], `${base.type} ${base.style} ${base.city} ${budget}`, 6).map(
          (match) => [match.property.slug, match],
        ),
      );
      const within = scores.get("cheap")?.reasons.includes("Within budget");
      expect(`${budget}: ${String(within)}`).toBe(`${budget}: true`);
      expect((scores.get("cheap")?.score ?? 0) - (scores.get("dear")?.score ?? 0)).toBe(5);
    }
  });

  it("reads runs of whitespace as one space", () => {
    const [base] = cards;
    if (base === undefined) throw new Error("no bundled property");
    const place = {
      ...base,
      slug: "place",
      city: "La Jolla",
      neighborhood: "x",
      region: "hudson-valley" as const,
    };
    expect(ranked(matchProperties([place], "a house in la  \t\n  jolla", 6))).toEqual(
      ranked(matchProperties([place], "a house in la jolla", 6)),
    );
    expect(matchProperties([place], "a house in la  \t\n  jolla", 6)).not.toEqual([]);
  });

  it("answers a 500-character whitespace query in bounded time, as it answers the trimmed query", () => {
    const copies = Math.ceil(40 / cards.length);
    const list = cards.flatMap((card) =>
      Array.from({ length: copies }, (_, copy) => ({
        ...card,
        slug: `${card.slug}-${String(copy)}`,
      })),
    );
    const queries = [
      `x${" ".repeat(498)}x`,
      `${" ".repeat(250)}modern house with a pool under 6m${" ".repeat(217)}`,
      " ".repeat(500),
    ];
    for (const query of queries) {
      const started = performance.now();
      const answer = ranked(matchProperties(list, query, 6));
      const elapsed = performance.now() - started;
      expect(elapsed).toBeLessThan(50);
      expect(answer).toEqual(ranked(matchProperties(list, query.trim(), 6)));
    }
  });
});
