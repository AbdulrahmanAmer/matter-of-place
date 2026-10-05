import { describe, expect, it } from "vitest";
import { absoluteUrl, siteConfig } from "../../src/config/site";
import { pageHead, serializeJsonForScript, unavailableHead } from "../../src/lib/seo";

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

  it("adds the robots meta only when noindex is set", () => {
    const robots = (head: ReturnType<typeof pageHead>) =>
      head.meta.flatMap((tag) => ("name" in tag && tag.name === "robots" ? [tag.content] : []));
    expect(robots(pageHead({ title: "About", description: "d", path: "/about" }))).toEqual([]);
    expect(
      robots(pageHead({ title: "About", description: "d", path: "/about", noindex: true })),
    ).toEqual(["noindex, nofollow"]);
  });

  it("adds an application/ld+json script only when jsonLd is given", () => {
    const jsonLd = { "@context": "https://schema.org", "@type": "Organization" };
    const plain = pageHead({ title: "About", description: "d", path: "/about" });
    const withData = pageHead({ title: "About", description: "d", path: "/about", jsonLd });
    expect(plain.scripts).toEqual([]);
    expect(withData.scripts).toEqual([
      { type: "application/ld+json", children: JSON.stringify(jsonLd) },
    ]);
  });

  it("sets the canonical link and og:url to the absolute url of the path", () => {
    const head = pageHead({ title: "Stories", description: "d", path: "/stories/a-quiet-house" });
    expect(head.links).toEqual([{ rel: "canonical", href: absoluteUrl("/stories/a-quiet-house") }]);
    expect(head.meta).toContainEqual({
      property: "og:url",
      content: absoluteUrl("/stories/a-quiet-house"),
    });
  });

  it("marks the head of an unresolved dynamic route noindex", () => {
    const head = unavailableHead("Property");
    expect(titleOf(head)).toBe(`Property unavailable | ${brand}`);
    expect(head.meta).toContainEqual({ name: "robots", content: "noindex, nofollow" });
  });
});

const metaContent = (head: ReturnType<typeof pageHead>, key: string) =>
  head.meta.flatMap((tag) =>
    ("name" in tag && tag.name === key) || ("property" in tag && tag.property === key)
      ? [tag.content]
      : [],
  );
const base = { title: "About", description: "d", path: "/about" };
const image = {
  url: "https://matterofplace.com/media/v/p/0-a/hero.webp",
  width: 1200,
  height: 630,
  alt: "A hall",
};

describe("pageHead image", () => {
  it("drops a relative image path", () => {
    const head = pageHead({ ...base, image: { ...image, url: "/assets/hero.jpg" } });
    expect(metaContent(head, "og:image")).toEqual([]);
    expect(metaContent(head, "twitter:image")).toEqual([]);
    expect(metaContent(head, "og:image:alt")).toEqual([]);
  });

  it("drops an http image and one that is not a url", () => {
    const http = pageHead({ ...base, image: { ...image, url: "http://matterofplace.com/a.jpg" } });
    const junk = pageHead({ ...base, image: { ...image, url: "not a url" } });
    expect([metaContent(http, "og:image"), metaContent(junk, "og:image")]).toEqual([[], []]);
  });

  it("writes the Open Graph and Twitter image tags for an absolute https image", () => {
    const head = pageHead({ ...base, image });
    expect(
      ["og:image", "og:image:width", "og:image:height", "og:image:alt", "twitter:image"].map(
        (key) => metaContent(head, key),
      ),
    ).toEqual([[image.url], ["1200"], ["630"], ["A hall"], [image.url]]);
  });
});

describe("pageHead tags", () => {
  it("repeats the title and description for Twitter and names the site and locale", () => {
    const head = pageHead(base);
    expect(
      ["twitter:title", "twitter:description", "og:site_name", "og:locale"].map((key) =>
        metaContent(head, key),
      ),
    ).toEqual([[`About | ${brand}`], ["d"], [brand], ["en_US"]]);
  });

  it("writes article dates only for an article", () => {
    const dates = { published: "2026-10-01", modified: "2026-10-04" };
    const article = pageHead({ ...base, type: "article", ...dates });
    const website = pageHead({ ...base, ...dates });
    expect([
      metaContent(article, "article:published_time"),
      metaContent(article, "article:modified_time"),
      metaContent(website, "article:published_time"),
      metaContent(website, "article:modified_time"),
    ]).toEqual([["2026-10-01"], ["2026-10-04"], [], []]);
  });
});

describe("pageHead canonical", () => {
  it.each([
    ["/properties?utm_source=x&q=a", "/properties"],
    ["/stories/a-quiet-house#top", "/stories/a-quiet-house"],
    ["/faq/", "/faq"],
    ["/?utm_source=x", "/"],
    ["/", "/"],
  ])("turns %s into %s", (path, expected) => {
    const head = pageHead({ ...base, path });
    expect(head.links).toEqual([{ rel: "canonical", href: absoluteUrl(expected) }]);
    expect(metaContent(head, "og:url")).toEqual([absoluteUrl(expected)]);
  });
});

describe("serializeJsonForScript", () => {
  it("escapes the characters that could end a script and reads back as the same value", () => {
    const value = { t: "</script><b>&\u2028\u2029" };
    const text = serializeJsonForScript(value);
    expect(/[<>&\u2028\u2029]/.test(text)).toBe(false);
    expect(JSON.parse(text)).toEqual(value);
  });

  it("leaves a payload without those characters as JSON.stringify writes it", () => {
    const value = { a: [1, "x"], b: { c: null } };
    expect(serializeJsonForScript(value)).toBe(JSON.stringify(value));
  });
});

describe("pageHead jsonLd", () => {
  const scriptBody = (head: ReturnType<typeof pageHead>) => head.scripts.at(0)?.children ?? "";

  it("never lets a hostile value close the script element", () => {
    const body = scriptBody(pageHead({ ...base, jsonLd: { name: "</script>" } }));
    expect(body.toLowerCase()).not.toContain("</script");
    expect(JSON.parse(body)).toEqual({ name: "</script>" });
  });

  it("wraps an array in one @graph", () => {
    const a = { "@type": "WebSite", name: "a" };
    const b = { "@type": "Organization", name: "b" };
    const head = pageHead({ ...base, jsonLd: [a, b] });
    expect(head.scripts).toHaveLength(1);
    expect(JSON.parse(scriptBody(head))).toEqual({
      "@context": "https://schema.org",
      "@graph": [a, b],
    });
  });
});
