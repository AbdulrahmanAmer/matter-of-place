import { describe, expect, it } from "vitest";
import { markets } from "../../src/data/markets";
import { properties } from "../../src/data/properties";
import { stories } from "../../src/data/stories";
import {
  archiveDescription,
  marketDescription,
  marketGuideDescription,
  pageDescription,
  pageDescriptionKeys,
  propertyDescription,
  regionDescription,
  storyDescription,
} from "../../src/lib/seo-copy";
import { slugify } from "../../src/lib/slug";

const BANNED =
  /exclusive|guarantee|stunning|luxury|unlock|buyers?\b|leads?\b|dream|world-class|once in a lifetime/i;

const copyRules: Record<string, (text: string) => boolean> = {
  "at least 70 characters": (text) => text.length >= 70,
  "at most 155 characters": (text) => text.length <= 155,
  "no em dash": (text) => !text.includes("\u2014"),
  "no dollar sign": (text) => !text.includes("$"),
  "no banned word": (text) => !BANNED.test(text),
  "no stray space": (text) => text === text.trim(),
};

const copyRuleBreaks = (text: string) =>
  Object.entries(copyRules)
    .filter(([, holds]) => !holds(text))
    .map(([rule]) => `${rule}: ${text}`);

const sample = {
  city: "Ojai",
  state: "California",
  beds: 1,
  interiorSqFt: 900,
  style: "Modern",
};
const longWord = "Architecture ".repeat(30).trim();

describe("page descriptions", () => {
  it.each(pageDescriptionKeys)("%s follows the copy rules", (key) => {
    expect(copyRuleBreaks(pageDescription(key))).toEqual([]);
  });

  it("gives every page its own description", () => {
    const all = pageDescriptionKeys.map((key) => pageDescription(key));
    expect(new Set(all).size).toBe(all.length);
  });
});

describe("descriptions written from data", () => {
  it("keep to the copy rules for every bundled property, story, market and region", () => {
    const texts = [
      ...properties.map((property) => propertyDescription(property)),
      ...stories.map((story) => storyDescription(story)),
      ...markets.flatMap((market) => [
        marketDescription(market),
        marketGuideDescription(market),
        ...market.regions.map((region) => regionDescription(region)),
      ]),
    ];
    expect(texts.length).toBeGreaterThan(30);
    for (const text of texts) expect(copyRuleBreaks(text)).toEqual([]);
  });

  it("describes an archive page for each kind", () => {
    const texts = [
      archiveDescription("city", "Los Altos Hills", 3),
      archiveDescription("architect", "Fixture Architect", 12),
      archiveDescription("style", "Shingle Style", 4),
    ];
    for (const text of texts) expect(copyRuleBreaks(text)).toEqual([]);
    expect(texts[0]).toContain("3 published properties in Los Altos Hills");
  });

  it("uses the singular for one bedroom", () => {
    expect(propertyDescription(sample)).toContain("1 bedroom, 900 sq ft");
  });

  it("completes a short story deck with the platform line", () => {
    const text = storyDescription({ deck: "A short deck." });
    expect(copyRuleBreaks(text)).toEqual([]);
    expect(text.startsWith("A short deck. Matter of Place is")).toBe(true);
  });

  it("cuts a long story deck at a word and ends it with a full stop", () => {
    const deck = `${longWord}. Second sentence.`;
    const text = storyDescription({ deck });
    expect(copyRuleBreaks(text)).toEqual([]);
    expect(text.endsWith(".")).toBe(true);
    const kept = text.slice(0, -1);
    expect(deck.startsWith(kept)).toBe(true);
    expect(deck.charAt(kept.length)).toBe(" ");
  });

  it("adds a second sentence only when it fits whole", () => {
    const intro = "A first sentence that is long enough to stand on its own as a description.";
    const near = [{ name: "Bay Area" }];
    const far = [{ name: "A very long region name that cannot sit beside the first sentence" }];
    expect(marketDescription({ intro: `${intro} Second.`, regions: near })).toBe(
      `${intro} Property stories across Bay Area.`,
    );
    expect(marketDescription({ intro: `${intro} Second.`, regions: far })).toBe(intro);
  });
});

describe("slugify", () => {
  it.each([
    ["Frank Lloyd Wright", "frank-lloyd-wright"],
    ["Fixture Architect", "fixture-architect"],
    ["  Shingle  Style ", "shingle-style"],
    ["Café O'Neil & Sons", "cafe-oneil-sons"],
    ["Mid-Century Modern", "mid-century-modern"],
    ["Zürich Villa", "zurich-villa"],
    ["", ""],
  ])("turns %j into %j", (label, expected) => {
    expect(slugify(label)).toBe(expected);
  });
});
