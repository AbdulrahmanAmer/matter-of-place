import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import fixture from "../../../src/templates/social/fixtures/property.fixture.json";
import { CarouselSlide } from "../../../src/templates/social/Carousel.tsx";
import { Cover } from "../../../src/templates/social/Cover.tsx";
import { OgCard } from "../../../src/templates/social/OgCard.tsx";
import { planCarousel, type SocialSource } from "../../../src/templates/social/slides.ts";
import { Story } from "../../../src/templates/social/Story.tsx";

const spec: SocialSource = {
  property: fixture.property,
  images: fixture.images.map((image) => ({
    url: `https://media.test/${image.path}`,
    alt: image.alt,
    orientation: image.orientation === "portrait" ? "portrait" : "landscape",
    w: image.w,
    h: image.h,
  })),
};

/** The wordmark outline is one long path; the snapshots keep the element and drop its data, one tag to a line. */
function markup(element: Parameters<typeof renderToStaticMarkup>[0]): string {
  return renderToStaticMarkup(element)
    .replace(/ d="[^"]*"/g, ' d=""')
    .replaceAll("><", ">\n<");
}

describe("Cover", () => {
  it("draws the hero, the location, the price and the specs on the cover frame", () => {
    expect(markup(createElement(Cover, { spec }))).toMatchInlineSnapshot(`
      "<link rel="preload" as="image" href="https://media.test/src/assets/los-altos.jpg"/>
      <div class="social-frame social-frame--cover">
      <div class="social-frame__photo">
      <img src="https://media.test/src/assets/los-altos.jpg" alt="Stone and glass residence with a terrace and an oak above the hills at sunset"/>
      </div>
      <svg class="social-frame__mark" viewBox="0 0 1645.72 110.4" role="img" aria-label="Matter of Place">
      <path d="" fill="currentColor">
      </path>
      </svg>
      <p class="social-frame__location">Los Altos Hills, California</p>
      <p class="social-frame__price">$8,950,000</p>
      <p class="social-frame__specs">5 bed · 4.5 bath · 4,320 sf</p>
      </div>"
    `);
  });

  it("gives the same HTML for the same spec", () => {
    expect(markup(createElement(Cover, { spec }))).toBe(markup(createElement(Cover, { spec })));
  });

  it("uses the taller frame for the X crop and the cover frame for the LinkedIn crop", () => {
    const frame = (crop?: "x" | "linkedin") =>
      /social-frame--[a-z-]+/.exec(
        markup(createElement(Cover, crop ? { spec, crop } : { spec })),
      )?.[0];
    expect([frame(), frame("x"), frame("linkedin")]).toEqual([
      "social-frame--cover",
      "social-frame--cover-x",
      "social-frame--cover",
    ]);
  });
});

describe("Story", () => {
  it("draws the hero, the location, the headline, the price and the specs on the story frame", () => {
    expect(markup(createElement(Story, { spec }))).toMatchInlineSnapshot(`
      "<link rel="preload" as="image" href="https://media.test/src/assets/los-altos.jpg"/>
      <div class="social-frame social-frame--story">
      <div class="social-frame__photo">
      <img src="https://media.test/src/assets/los-altos.jpg" alt="Stone and glass residence with a terrace and an oak above the hills at sunset"/>
      </div>
      <svg class="social-frame__mark" viewBox="0 0 1645.72 110.4" role="img" aria-label="Matter of Place">
      <path d="" fill="currentColor">
      </path>
      </svg>
      <p class="social-frame__location">Los Altos Hills, California</p>
      <h1 class="social-frame__headline">A residence shaped around the landscape.</h1>
      <p class="social-frame__price">$8,950,000</p>
      <p class="social-frame__specs">5 bed · 4.5 bath · 4,320 sf</p>
      </div>"
    `);
  });
});

describe("OgCard", () => {
  const image = { url: "https://media.test/california.jpg", alt: "Hills at dusk" };

  it("draws a photograph and the title on the market card", () => {
    expect(
      markup(
        createElement(OgCard, { variant: "market", kicker: "Market", title: "California", image }),
      ),
    ).toMatchInlineSnapshot(`
      "<link rel="preload" as="image" href="https://media.test/california.jpg"/>
      <div class="social-frame social-frame--cover">
      <div class="social-frame__photo">
      <img src="https://media.test/california.jpg" alt="Hills at dusk"/>
      </div>
      <svg class="social-frame__mark" viewBox="0 0 1645.72 110.4" role="img" aria-label="Matter of Place">
      <path d="" fill="currentColor">
      </path>
      </svg>
      <p class="social-frame__location">Market</p>
      <p class="social-frame__price">California</p>
      </div>"
    `);
  });

  it("draws no photograph on the default card", () => {
    const html = markup(
      createElement(OgCard, {
        variant: "default",
        kicker: "Matter of Place",
        title: "Properly considered",
      }),
    );
    expect([html.includes("<img"), html.includes("Properly considered")]).toEqual([false, true]);
  });
});

describe("CarouselSlide", () => {
  const slides = planCarousel(spec);
  const slide = (at: number) => {
    const planned = slides[at];
    if (!planned) throw new Error(`no slide ${String(at)}`);
    return markup(
      createElement(CarouselSlide, { spec, slide: planned, index: at, total: slides.length }),
    );
  };

  it("marks the position and carries the full frame on the cover slide", () => {
    expect(slide(0)).toMatchInlineSnapshot(`
      "<link rel="preload" as="image" href="https://media.test/src/assets/los-altos.jpg"/>
      <div class="social-frame social-frame--carousel">
      <div class="social-frame__photo">
      <img src="https://media.test/src/assets/los-altos.jpg" alt="Stone and glass residence with a terrace and an oak above the hills at sunset"/>
      </div>
      <svg class="social-frame__mark" viewBox="0 0 1645.72 110.4" role="img" aria-label="Matter of Place">
      <path d="" fill="currentColor">
      </path>
      </svg>
      <p class="social-frame__marker">01 / 08</p>
      <p class="social-frame__location">Los Altos Hills, California</p>
      <h1 class="social-frame__headline">A residence shaped around the landscape.</h1>
      <p class="social-frame__price">$8,950,000</p>
      <p class="social-frame__specs">5 bed · 4.5 bath · 4,320 sf</p>
      </div>"
    `);
  });

  it("carries the position, the location and one photograph on a photograph slide", () => {
    const html = slide(1);
    expect([
      html.includes("02 / 08"),
      html.includes("Los Altos Hills, California"),
      html.includes("$8,950,000"),
    ]).toEqual([true, true, false]);
  });

  it("carries the type, the year, the price and the specs on the facts slide", () => {
    const html = slide(slides.findIndex((planned) => planned.kind === "facts"));
    expect(
      ["Estate, built 2021", "$8,950,000", "5 bed · 4.5 bath · 4,320 sf"].every((text) =>
        html.includes(text),
      ),
    ).toBe(true);
  });

  it("carries the first sentence of the place paragraph on the place slide", () => {
    const html = slide(slides.findIndex((planned) => planned.kind === "place"));
    expect(
      html.includes(
        "Los Altos Hills offers a quieter setting within reach of the Peninsula and Silicon Valley.",
      ),
    ).toBe(true);
  });
});

describe("the social templates", () => {
  it("carry no em dash, no colour value and no inline style", () => {
    const all = [
      markup(createElement(Cover, { spec })),
      markup(createElement(Story, { spec })),
      ...planCarousel(spec).map((planned, at, list) =>
        markup(
          createElement(CarouselSlide, { spec, slide: planned, index: at, total: list.length }),
        ),
      ),
    ].join("");
    expect([all.includes("—"), /#[0-9a-f]{3,6}\b/i.test(all), all.includes("style=")]).toEqual([
      false,
      false,
      false,
    ]);
  });
});
