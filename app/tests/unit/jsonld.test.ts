import { describe, expect, it } from "vitest";
import { z } from "zod";
import { validateHtml } from "../../scripts/validate-jsonld";
import { absoluteUrl } from "../../src/config/site";
import { properties } from "../../src/data/properties";
import { stories } from "../../src/data/stories";
import {
  articleLd,
  breadcrumbLd,
  collectionLd,
  propertyListingLd,
  videoLd,
  websiteLd,
} from "../../src/lib/jsonld";
import type { Property } from "../../src/domain/property";
import { faqJsonLd, pageHead } from "../../src/lib/seo";

const first = properties[0];
const story = stories[0];
if (first === undefined || story === undefined) throw new Error("no bundled data");

const plain = z.record(z.unknown());
const nodeOf = (value: object) => plain.parse(value);

/** The page head's script, as the HTML the validator reads. */
function pageHtml(jsonLd: object | object[]): string {
  const { scripts } = pageHead({ title: "T", description: "d", path: "/", jsonLd });
  return scripts
    .map((script) => `<script type="application/ld+json">${script.children}</script>`)
    .join("");
}

const listed = {
  ...first,
  status: "Active" as const,
  heroVariants: { hero: { w: 2400, h: 1600, webp: "/media/p/hero.webp" } },
  gallery: [
    {
      src: "/a.jpg",
      alt: "a",
      orientation: "landscape" as const,
      variants: { hero: { w: 2400, h: 1600, webp: "/media/p/g1.webp" } },
    },
    { src: "/b.jpg", alt: "b", orientation: "landscape" as const },
  ],
};

describe("WebSite", () => {
  it("carries the site search, and parses as a graph node", () => {
    const site = nodeOf(websiteLd());
    expect(site).toMatchObject({
      "@type": "WebSite",
      "@id": absoluteUrl("/#website"),
      potentialAction: {
        "@type": "SearchAction",
        target: absoluteUrl("/properties?q={search_term_string}"),
        "query-input": "required name=search_term_string",
      },
    });
    expect(validateHtml(pageHtml([websiteLd()]))).toEqual(["WebSite"]);
  });
});

describe("breadcrumbLd", () => {
  it("starts at Home in position 1 and counts up with absolute addresses", () => {
    const trail = nodeOf(
      breadcrumbLd([
        { name: "Markets", path: "/markets" },
        { name: "California", path: "/california" },
      ]),
    );
    expect(trail["itemListElement"]).toEqual([
      { "@type": "ListItem", position: 1, name: "Home", item: absoluteUrl("/") },
      { "@type": "ListItem", position: 2, name: "Markets", item: absoluteUrl("/markets") },
      { "@type": "ListItem", position: 3, name: "California", item: absoluteUrl("/california") },
    ]);
    expect(validateHtml(pageHtml([breadcrumbLd([{ name: "Markets", path: "/markets" }])]))).toEqual(
      ["BreadcrumbList"],
    );
  });
});

describe("propertyListingLd", () => {
  it("parses as a RealEstateListing with the posting date", () => {
    expect(validateHtml(pageHtml([propertyListingLd(listed)]))).toEqual(["RealEstateListing"]);
    expect(nodeOf(propertyListingLd(listed))).toMatchObject({
      "@type": "RealEstateListing",
      url: absoluteUrl(`/property/${listed.slug}`),
      datePosted: listed.publishedAt,
    });
  });

  it("states the place to city level only: no geo and no street address", () => {
    const withCoordinates = { ...listed, coordinates: [37.9, -122.5] as [number, number] };
    const listing = nodeOf(propertyListingLd(withCoordinates));
    const about = plain.parse(listing["about"]);
    expect(listing).not.toHaveProperty("geo");
    expect(about).not.toHaveProperty("geo");
    expect(plain.parse(about["address"])).toEqual({
      "@type": "PostalAddress",
      addressLocality: listed.city,
      addressRegion: listed.state,
      addressCountry: listed.country,
    });
  });

  it("offers the property only while it is Active", () => {
    const offers = (status: Property["status"]) =>
      nodeOf(propertyListingLd({ ...listed, status }))["offers"];
    expect(offers("Active")).toMatchObject({
      "@type": "Offer",
      price: listed.price,
      priceCurrency: listed.currency,
    });
    const others = ["Illustrative", "Off-market", "Under offer", "Sold"] as const;
    expect(others.filter((status) => offers(status) !== undefined)).toEqual([]);
  });

  it("lists only images on the public media route or an https address, as absolute URLs", () => {
    expect(nodeOf(propertyListingLd(listed))["image"]).toEqual([
      absoluteUrl("/media/p/hero.webp"),
      absoluteUrl("/media/p/g1.webp"),
    ]);
    expect(
      nodeOf(propertyListingLd({ ...listed, heroVariants: undefined, gallery: [] })),
    ).not.toHaveProperty("image");
  });
});

describe("articleLd", () => {
  it("parses as an Article with datePublished and a headline without the closing full stop", () => {
    expect(validateHtml(pageHtml([articleLd(story)]))).toEqual(["Article"]);
    const article = nodeOf(articleLd({ ...story, title: "Light on the bay." }));
    expect(article).toMatchObject({
      "@type": "Article",
      headline: "Light on the bay",
      datePublished: story.publishedAt,
      mainEntityOfPage: absoluteUrl(`/stories/${story.slug}`),
    });
  });

  it("leaves the image out unless it is on the media route or https", () => {
    expect(nodeOf(articleLd({ ...story, image: "/assets/x.jpg" }))).not.toHaveProperty("image");
    expect(nodeOf(articleLd({ ...story, image: "/media/s/x.webp" }))["image"]).toBe(
      absoluteUrl("/media/s/x.webp"),
    );
  });
});

describe("collectionLd", () => {
  it("parses as a CollectionPage whose ItemList counts from position 1", () => {
    const items = [
      { name: "One", path: "/property/one" },
      { name: "Two", path: "/property/two" },
    ];
    const page = nodeOf(collectionLd("city", "Tiburon", "/archive/city/tiburon", items));
    expect(page).toMatchObject({
      "@type": "CollectionPage",
      url: absoluteUrl("/archive/city/tiburon"),
    });
    expect(plain.parse(page["mainEntity"])).toMatchObject({
      "@type": "ItemList",
      numberOfItems: 2,
      itemListElement: [
        { position: 1, name: "One", url: absoluteUrl("/property/one") },
        { position: 2, name: "Two", url: absoluteUrl("/property/two") },
      ],
    });
    expect(
      validateHtml(pageHtml([collectionLd("city", "Tiburon", "/archive/city/tiburon", items)])),
    ).toEqual(["CollectionPage"]);
  });
});

describe("faqJsonLd", () => {
  it("parses as a FAQPage", () => {
    expect(validateHtml(pageHtml(faqJsonLd([{ q: "What?", a: "This." }])))).toEqual(["FAQPage"]);
  });
});

describe("videoLd", () => {
  const film = {
    src: "/media/v/a.mp4",
    poster: "/media/v/a.jpg",
    caption: "Evening",
    duration: "0:18",
  };

  it("returns null without a video", () => {
    expect(videoLd({})).toBeNull();
  });

  it("returns null for a src that is neither under /media/ nor an absolute https address", () => {
    const foreign = ["/assets/a.mp4", "http://example.com/a.mp4", "a.mp4", "//example.com/a.mp4"];
    expect(foreign.filter((src) => videoLd({ video: { ...film, src } }) !== null)).toEqual([]);
    expect(videoLd({ video: { ...film, src: "https://example.com/a.mp4" } })).not.toBeNull();
  });

  it("makes the media addresses absolute and writes the duration in ISO 8601", () => {
    const video = nodeOf(videoLd({ video: film }) ?? {});
    expect(video).toMatchObject({
      "@type": "VideoObject",
      name: "Evening",
      contentUrl: "https://matterofplace.com/media/v/a.mp4",
      thumbnailUrl: "https://matterofplace.com/media/v/a.jpg",
      duration: "PT18S",
    });
    expect(video).not.toHaveProperty("uploadDate");
    expect(validateHtml(pageHtml([videoLd({ video: film }) ?? {}]))).toEqual(["VideoObject"]);
  });

  it("converts minutes and hours, and leaves a duration that is not a clock reading out", () => {
    const duration = (value: string) =>
      nodeOf(videoLd({ video: { ...film, duration: value } }) ?? {})["duration"];
    expect(duration("1:05")).toBe("PT1M5S");
    expect(duration("2:00")).toBe("PT2M");
    expect(duration("1:02:03")).toBe("PT1H2M3S");
    expect(duration("soon")).toBeUndefined();
    expect(duration("0:00")).toBeUndefined();
  });

  it("omits the thumbnail when the poster is a bundled asset", () => {
    expect(
      nodeOf(videoLd({ video: { ...film, poster: "/assets/p.jpg" } }) ?? {}),
    ).not.toHaveProperty("thumbnailUrl");
  });
});

describe("validateHtml", () => {
  const wrap = (body: string) => `<script type="application/ld+json">${body}</script>`;

  it("refuses a page with no structured data", () => {
    expect(() => validateHtml("<html></html>")).toThrow("no application/ld+json block");
  });

  it("refuses a block that is not JSON", () => {
    expect(() => validateHtml(wrap("{nope"))).toThrow("is not valid JSON");
  });

  it("refuses a block without the schema.org context", () => {
    expect(() =>
      validateHtml(wrap('{"@type":"WebSite","name":"n","url":"https://x.test"}')),
    ).toThrow("@context");
  });

  it("names the type and the field of a node that lacks a required one", () => {
    const body = '{"@context":"https://schema.org","@graph":[{"@type":"Article","headline":"h"}]}';
    expect(() => validateHtml(wrap(body))).toThrow(/Article\.datePublished/);
  });

  it("reads a single block and a graph alike, and lists the types in page order", () => {
    const single = wrap(
      '{"@context":"https://schema.org","@type":"WebSite","name":"n","url":"https://x.test"}',
    );
    expect(validateHtml(single)).toEqual(["WebSite"]);
    expect(validateHtml(pageHtml([websiteLd(), breadcrumbLd([])]))).toEqual([
      "WebSite",
      "BreadcrumbList",
    ]);
  });
});
