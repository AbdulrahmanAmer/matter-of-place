import { describe, expect, it } from "vitest";
import {
  planCarousel,
  planLinkedInSet,
  type SocialSource,
} from "../../../src/templates/social/slides.ts";

const PLACE =
  "Los Altos Hills offers a quieter setting. Its lanes give each property its own terrain.";

function source(imageCount: number, place: string | null): SocialSource {
  return {
    property: {
      id: "mop-001",
      slug: "oak-hill-residence",
      title: "A residence shaped around the landscape.",
      city: "Los Altos Hills",
      state: "California",
      market: "california",
      price: 8950000,
      currency: "USD",
      beds: 5,
      baths: 4.5,
      interiorSqFt: 4320,
      yearBuilt: 2021,
      type: "Estate",
      ...(place === null ? {} : { place }),
    },
    images: Array.from({ length: imageCount }, (_, at) => ({
      url: `https://media.test/${String(at)}.jpg`,
      alt: `Photograph ${String(at)}`,
      orientation: "landscape" as const,
      w: 1600,
      h: 1200,
    })),
  };
}

const GALLERIES = [3, 6, 12];
const PLACES = [PLACE, null];

describe("planCarousel", () => {
  it.each(GALLERIES.flatMap((count) => PLACES.map((place) => ({ count, place }))))(
    "plans 6 to 8 slides for $count images",
    ({ count, place }) => {
      const slides = planCarousel(source(count, place));
      expect(slides.length).toBeGreaterThanOrEqual(6);
      expect(slides.length).toBeLessThanOrEqual(8);
    },
  );

  it("gives exactly 6 slides for 12 images when max_slides is 6", () => {
    expect(planCarousel(source(12, PLACE), 6)).toHaveLength(6);
    expect(planCarousel(source(12, null), 6)).toHaveLength(6);
  });

  it("never plans more than 8 or fewer than 6, whatever max_slides says", () => {
    expect(planCarousel(source(12, PLACE), 12)).toHaveLength(8);
    expect(planCarousel(source(12, PLACE), 2)).toHaveLength(6);
  });

  it("opens on the hero, closes on the hero and keeps the kinds in order", () => {
    const slides = planCarousel(source(12, PLACE));
    expect(slides.map((slide) => slide.kind)).toEqual([
      "cover",
      "photo",
      "photo",
      "photo",
      "photo",
      "facts",
      "place",
      "close",
    ]);
    expect([slides[0]?.image, slides.at(-1)?.image]).toEqual([0, 0]);
  });

  it("holds the place slide back until the property has a place paragraph and the limit has room", () => {
    const kinds = (slides: ReturnType<typeof planCarousel>) => slides.map((slide) => slide.kind);
    expect(kinds(planCarousel(source(12, null)))).not.toContain("place");
    expect(kinds(planCarousel(source(12, "   ")))).not.toContain("place");
    expect(kinds(planCarousel(source(12, PLACE), 6))).not.toContain("place");
    expect(kinds(planCarousel(source(12, PLACE), 7))).toContain("place");
  });

  it("puts the first sentence of the place paragraph on the place slide", () => {
    const place = planCarousel(source(6, PLACE)).find((slide) => slide.kind === "place");
    expect(place).toEqual({
      kind: "place",
      image: 0,
      text: "Los Altos Hills offers a quieter setting.",
    });
  });

  it("points every slide at a photograph the gallery holds", () => {
    for (const count of GALLERIES) {
      const slides = planCarousel(source(count, PLACE));
      expect(slides.every((slide) => slide.image >= 0 && slide.image < count)).toBe(true);
    }
  });

  it("plans the same slides for the same spec", () => {
    expect(planCarousel(source(6, PLACE), 7)).toEqual(planCarousel(source(6, PLACE), 7));
  });
});

describe("planLinkedInSet", () => {
  it("picks the cover and three photographs from a full gallery", () => {
    expect(planLinkedInSet(source(12, PLACE)).map((slide) => [slide.kind, slide.image])).toEqual([
      ["cover", 0],
      ["photo", 1],
      ["photo", 2],
      ["photo", 3],
    ]);
  });

  it("picks the cover and two photographs from three images", () => {
    expect(planLinkedInSet(source(3, null))).toHaveLength(3);
  });
});
