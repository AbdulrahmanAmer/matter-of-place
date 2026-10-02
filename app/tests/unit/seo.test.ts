import { describe, expect, it } from "vitest";
import { siteConfig } from "../../src/config/site";
import { pageHead } from "../../src/lib/seo";

const brand = siteConfig.name;
const countBrand = (value: string) => value.split(brand).length - 1;
const titleOf = (head: ReturnType<typeof pageHead>) =>
  head.meta.flatMap((tag) => ("title" in tag ? [tag.title] : [])).at(0) ?? "";

describe("pageHead", () => {
  it("appends the brand suffix to a bare page title", () => {
    const title = titleOf(pageHead({ title: "About", description: "d", path: "/about" }));
    expect(title).toBe(`About | ${brand}`);
    expect(countBrand(title)).toBe(1);
  });

  it("leaves a title alone when it already ends with the suffix", () => {
    const given = `Properties | ${brand}`;
    const title = titleOf(pageHead({ title: given, description: "d", path: "/properties" }));
    expect(title).toBe(given);
    expect(countBrand(title)).toBe(1);
  });

  it("does not add the suffix to the home title, which starts with the brand (GOTCHAS G-003)", () => {
    const given = `${brand} | Exceptional property. Properly considered.`;
    const head = pageHead({ title: given, description: "d", path: "/" });
    const title = titleOf(head);
    expect(title).toBe(given);
    expect(countBrand(title)).toBe(1);
    const ogTitle = head.meta.flatMap((tag) =>
      "property" in tag && tag.property === "og:title" ? [tag.content] : [],
    );
    expect(ogTitle).toEqual([given]);
  });

  it("uses the bare brand as the title when the brand alone is passed", () => {
    const title = titleOf(pageHead({ title: brand, description: "d", path: "/" }));
    expect(title).toBe(brand);
    expect(countBrand(title)).toBe(1);
  });
});
