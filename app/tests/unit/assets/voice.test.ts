// B9 step 9: brand voice checked by code (invariant 5). Each rule has a failing and a passing sample.
import { describe, expect, it } from "vitest";
import { propertyLink, X_LINK_LENGTH } from "../../../src/server/assets/links";
import {
  lintCaption,
  type CaptionChannel,
  type CaptionProperty,
  type LintRule,
} from "../../../src/server/assets/voice";

const PROPERTY: CaptionProperty = {
  slug: "oak-hill",
  title: "A residence under old oaks",
  city: "Los Altos Hills",
  state: "California",
  type: "Estate",
  place: "A quiet street under old oaks.",
  price: 4_200_000,
  beds: 5,
  baths: 4.5,
  interior_sq_ft: 4320,
  year_built: 2021,
};

const rules = (text: string, channel: CaptionChannel = "instagram"): LintRule[] =>
  lintCaption(text, PROPERTY, channel).map((issue) => issue.rule);

describe("lintCaption", () => {
  it("passes a calm caption with its facts", () => {
    expect(rules("A quiet house in the hills. Five bedrooms, built in 2021.")).toEqual([]);
  });

  it("an em dash fails and a comma passes", () => {
    expect(rules("Stone and glass \u2014 a quiet house.")).toContain("em_dash");
    expect(rules("Stone and glass, a quiet house.")).toEqual([]);
  });

  it.each([
    "A stunning home.",
    "Your dream home.",
    "A must-see house.",
    "Luxury living in the hills.",
    "Just listed in Los Altos Hills.",
  ])("the banned phrase in %j fails", (text) => {
    expect(rules(text)).toContain("banned_word");
  });

  it("a word that only contains a banned one passes", () => {
    expect(rules("The dreamlike light stays in the hall.")).toEqual([]);
  });

  it("an exclamation mark fails and a full stop passes", () => {
    expect(rules("A quiet house!")).toContain("exclamation");
    expect(rules("A quiet house.")).toEqual([]);
  });

  it("a hashtag fails and plain words pass", () => {
    expect(rules("A quiet house #oakhill")).toContain("hashtag");
    expect(rules("A quiet house on Oak Hill.")).toEqual([]);
  });

  it.each(["Guaranteed to sell.", "More leads for your listing.", "Serious buyers will call."])(
    "the guarantee in %j fails",
    (text) => {
      expect(rules(text)).toContain("guarantee");
    },
  );

  it("a stair that leads to a terrace is not a guarantee", () => {
    expect(rules("A stair leads to the terrace.")).toEqual([]);
  });

  it("a $4,200,000 home of exceptional quality fails the merit rule", () => {
    expect(rules("A $4,200,000 home of exceptional quality")).toContain("price_merit");
  });

  it("a price in its own sentence passes", () => {
    expect(rules("$4,200,000. Five bedrooms on two acres.")).toEqual([]);
    expect(rules("Five bedrooms of exceptional light. $4,200,000.")).toEqual([]);
  });

  it("a number that is not in the property row fails and the row's own numbers pass", () => {
    expect(rules("Built in 1999.")).toContain("number_unknown");
    expect(rules("Built in 2021, 4,320 square feet, 4.5 baths, $4,200,000.")).toEqual([]);
  });

  it("the x variant must carry its own link", () => {
    const link = propertyLink("oak-hill", "x");
    expect(rules(`A quiet house in the hills. ${link}`, "x")).toEqual([]);
    expect(rules("A quiet house in the hills.", "x")).toContain("link");
    expect(rules(`A quiet house. ${propertyLink("oak-hill", "linkedin")}`, "x")).toContain("link");
  });

  it("an instagram caption carries no link of another channel", () => {
    expect(rules(`A quiet house. ${propertyLink("oak-hill", "x")}`)).toContain("link");
  });

  it("instagram holds 2200 characters and not 2201", () => {
    expect(rules("a".repeat(2200))).toEqual([]);
    expect(rules("a".repeat(2201))).toContain("length");
  });

  it("the x variant counts its link at 23 characters", () => {
    const link = propertyLink("oak-hill", "x");
    expect(link.length).toBeGreaterThan(X_LINK_LENGTH * 2);
    expect(rules(`${"a".repeat(256)} ${link}`, "x")).toEqual([]);
    expect(rules(`${"a".repeat(257)} ${link}`, "x")).toContain("length");
  });

  it("linkedin holds 3000 characters and keeps the banned-word and guarantee rules", () => {
    expect(rules("a".repeat(3000), "linkedin")).toEqual([]);
    expect(rules("a".repeat(3001), "linkedin")).toContain("length");
    expect(rules("A stunning house.", "linkedin")).toContain("banned_word");
    expect(rules("Guaranteed to sell.", "linkedin")).toContain("guarantee");
  });
});
