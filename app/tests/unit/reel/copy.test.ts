// B12 step 3, invariant 5: every string the reel draws is calm and factual and passes the brand voice of B9.
import { describe, expect, it } from "vitest";
import { t } from "../../../src/lib/strings";
import { lintCaption } from "../../../src/server/assets/voice.ts";
import { reelCopy, type ReelSpec } from "../../../src/server/assets/reel-spec.ts";
import fixture from "../../../../launch/reel/fixture-spec.json";

const EM_DASH = String.fromCharCode(0x2014);

type Property = ReelSpec["property"];

const properties: Property[] = [
  fixture.property,
  {
    title: "A prewar apartment above the park",
    city: "New York",
    state: "New York",
    market: "new-york",
    price: 4250000,
    currency: "USD",
    beds: 3,
    baths: 2.5,
    interiorSqFt: 2150,
    type: "Apartment",
  },
  {
    title: "A house on the water at Indian Creek",
    city: "Palm Beach Gardens",
    state: "Florida",
    market: "florida",
    price: 12400000,
    currency: "USD",
    beds: 6,
    baths: 7.5,
    interiorSqFt: 8200,
    type: "Waterfront",
  },
];

function issues(text: string, property: Property): string[] {
  return lintCaption(
    text,
    {
      slug: "reel-fixture",
      title: property.title,
      city: property.city,
      state: property.state,
      place: null,
      price: property.price,
      beds: property.beds,
      baths: property.baths,
      interior_sq_ft: property.interiorSqFt,
      year_built: 2021,
      type: property.type,
    },
    "instagram",
  ).map((issue) => issue.rule);
}

describe("reelCopy", () => {
  it("writes location, facts, price, site and credit as the storyboard shows them", () => {
    expect(reelCopy(fixture.property)).toEqual({
      location: "LOS ALTOS HILLS, CALIFORNIA",
      title: "A residence shaped around the landscape.",
      facts: "5 BED · 4.5 BATH · 4,320 SF",
      price: "$8,950,000",
      site: "matterofplace.com",
      credit: "A product of Omnikom",
    });
  });

  it.each(properties)("passes the caption lint and the voice rules: $city", (property) => {
    const copy = reelCopy(property);
    for (const text of Object.values(copy)) {
      expect(text).not.toContain(EM_DASH);
      expect(text).not.toContain("!");
      expect(text).not.toMatch(/just listed/i);
      expect(issues(text, property)).toEqual([]);
    }
  });

  it("gives the fixture file the same copy block reelCopy builds", () => {
    expect(fixture.copy).toEqual(reelCopy(fixture.property));
  });

  it("starts the credit of B16's footer line", ({ skip }) => {
    // B16 step 4 has not landed: strings.ts still reads "An Omnikom company." (GOTCHAS P-2101). Only that old value skips.
    const footer: string = t.footer.line;
    skip(footer === "An Omnikom company.");
    expect(footer.startsWith(reelCopy(fixture.property).credit)).toBe(true);
  });
});

describe("the fixture copy block", () => {
  it("passes the same rules", () => {
    for (const text of Object.values(fixture.copy)) {
      expect(text).not.toContain(EM_DASH);
      expect(text).not.toContain("!");
      expect(text).not.toMatch(/just listed/i);
      expect(issues(text, fixture.property)).toEqual([]);
    }
  });
});
