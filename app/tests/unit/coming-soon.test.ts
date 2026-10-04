// The pure helpers behind the coming-soon block (B3b): which markets are open, whether a list is empty, the
// `source` of an interest signup and the paragraph a scope shows.
import { describe, expect, it } from "vitest";
import {
  comingSoonText,
  hasListings,
  interestSource,
  isComingSoon,
  openMarkets,
} from "../../src/lib/coming-soon";
import { fill, t } from "../../src/lib/strings";

const florida = { name: "Florida", slug: "florida" } as const;
const miami = { name: "Miami", slug: "miami" } as const;

describe("isComingSoon and openMarkets", () => {
  it("reads a market's comingSoon and keeps only the open ones, in order", () => {
    const markets = [
      { slug: "california", comingSoon: false },
      { slug: "florida", comingSoon: true },
      { slug: "new-york", comingSoon: false },
    ];
    expect(isComingSoon({ comingSoon: true })).toBe(true);
    expect(isComingSoon({ comingSoon: false })).toBe(false);
    expect(openMarkets(markets).map((market) => market.slug)).toEqual(["california", "new-york"]);
  });
});

describe("hasListings", () => {
  it("is false for an empty list and true for one property", () => {
    expect(hasListings([])).toBe(false);
    expect(hasListings([{ slug: "a" }])).toBe(true);
  });
});

describe("interestSource", () => {
  it("names the page scopes, the market and the market with its region", () => {
    expect(interestSource("home")).toBe("interest:home");
    expect(interestSource("properties")).toBe("interest:properties");
    expect(interestSource("stories")).toBe("interest:stories");
    expect(interestSource("market", florida)).toBe("interest:florida");
    expect(interestSource("region", florida, miami)).toBe("interest:florida/miami");
  });
});

describe("fill", () => {
  it("fills every occurrence of a placeholder and leaves an unknown one as written", () => {
    expect(fill("{a} and {a} and {b}", { a: "x" })).toBe("x and x and {b}");
  });
});

describe("comingSoonText", () => {
  it("returns the market's own copy for the market and region scopes when it is set", () => {
    const market = { ...florida, interestCopy: "Our Florida desk opens in spring." };
    expect(comingSoonText("market", market)).toBe("Our Florida desk opens in spring.");
    expect(comingSoonText("region", market, miami)).toBe("Our Florida desk opens in spring.");
  });

  it("returns the table string with the names filled when the copy is empty or unset", () => {
    expect(comingSoonText("market", { ...florida, interestCopy: "" })).toBe(
      fill(t.comingSoon.market.text, { market: "Florida" }),
    );
    expect(comingSoonText("market", florida)).toBe(
      "The Florida desk is reading the market and reviewing what agents send us. We will write when the first Florida property is published.",
    );
    expect(comingSoonText("region", florida, miami)).toBe(
      "The first Florida properties will appear here and on the Florida page. Leave your email and we will write when they do.",
    );
  });

  it("ignores the market's copy for the home, properties and stories scopes", () => {
    const market = { ...florida, interestCopy: "Our Florida desk opens in spring." };
    expect(comingSoonText("home", market)).toBe(t.comingSoon.home.text);
    expect(comingSoonText("properties")).toBe(t.comingSoon.properties.text);
    expect(comingSoonText("stories", market)).toBe(t.comingSoon.stories.text);
  });
});
