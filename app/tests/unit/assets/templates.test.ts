import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SiteContext } from "../../../src/server/email/context";
import { renderTemplate, type RenderRow } from "../../../src/server/email/render";
import { lintEmail } from "../../../scripts/lib/email-lint";
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

const site: SiteContext = {
  siteUrl: "https://matterofplace.com",
  entity: null,
  address: null,
  contact: { email: null },
};

// The stored block of a Campaign property and the row B11 seeds for `standalone`: no blocks of its own.
const block = {
  title: "412 Alder Lane",
  deck: "A quiet house above the water.",
  image_key: "properties/p1/og.webp",
  image_url: "https://matterofplace.com/media/properties/p1/og.webp",
  link: "https://matterofplace.com/properties/alder-lane?utm_source=newsletter",
};

const standalone: RenderRow = {
  key: "standalone",
  subject: "{{subject}}",
  preheader: "{{preheader}}",
  body: [],
};
const variables = { subject: "Alder Lane", preheader: "A new property" };

describe("the standalone email", () => {
  it("draws the property block it is given, from an empty body, with no placeholder left", async () => {
    const { html, text } = await renderTemplate(standalone, { ...variables, block }, site);
    expect(html).toContain(block.title);
    expect(html).toContain(block.deck);
    expect(html).toContain(`src="${block.image_url}"`);
    expect(html).toContain(`href="${block.link}"`);
    expect(html).toContain(`alt="${block.title}"`);
    // The one placeholder left is Resend's unsubscribe link, which Resend fills at send time.
    expect(html).toContain('href="{{{RESEND_UNSUBSCRIBE_URL}}}"');
    expect(html.replace("{{{RESEND_UNSUBSCRIBE_URL}}}", "")).not.toContain("{{");
    expect(text.replace("{{{RESEND_UNSUBSCRIBE_URL}}}", "")).not.toContain("{{");
  });

  it("uses the alt text of the asset when one is given", async () => {
    const { html } = await renderTemplate(
      standalone,
      { ...variables, block: { ...block, alt: "The house at dusk" } },
      site,
    );
    expect(html).toContain('alt="The house at dusk"');
  });

  it("draws no property block when it is given none", async () => {
    const { html } = await renderTemplate(standalone, variables, site);
    expect(html).not.toContain("View the property");
    expect(html).not.toContain(block.title);
    expect(html).not.toContain('<img src="https://matterofplace.com/media');
  });

  it("passes the email gate on the block it draws: an image with a width and no empty link", async () => {
    const { html, text } = await renderTemplate(standalone, { ...variables, block }, site);
    // The plain-text part of a Campaign email does not yet hold the block's link (B11's follow-up), so text-url is left out.
    const rules = lintEmail(html, text, "standalone")
      .map((finding) => finding.rule)
      .filter((rule) => rule !== "text-url");
    expect(rules).toEqual([]);
  });

  it("refuses a block whose link or image is not an https address", async () => {
    for (const bad of [
      { ...block, link: "javascript:alert(1)" },
      { ...block, image_url: "http://matterofplace.com/media/properties/p1/og.webp" },
    ]) {
      await expect(renderTemplate(standalone, { ...variables, block: bad }, site)).rejects.toThrow(
        "template_render_failed",
      );
    }
  });

  it("refuses a block that is not a block", async () => {
    await expect(
      renderTemplate(standalone, { ...variables, block: { title: "No picture" } }, site),
    ).rejects.toThrow("template_render_failed");
  });
});

// vitest resolves the Node build of @react-email/render; the Worker resolves the `workerd` condition, the edge build.
// A throwing component resolves with a fallback in the first and rejects in the second (measured 2026-10-07).
const edgeBuild = "../../../node_modules/@react-email/render/dist/edge/index.mjs";

describe("the standalone email under the render build the Worker bundles", () => {
  afterEach(() => {
    vi.doUnmock("@react-email/render");
    vi.resetModules();
  });

  async function underEdge() {
    vi.resetModules();
    vi.doMock("@react-email/render", () => import(/* @vite-ignore */ edgeBuild));
    const [{ renderTemplate: render }, { NonRetryableError }] = await Promise.all([
      import("../../../src/server/email/render"),
      import("../../../src/server/jobs/types"),
    ]);
    return { render, NonRetryableError };
  }

  it("still draws the property block it is given", async () => {
    const { render } = await underEdge();
    const { html } = await render(standalone, { ...variables, block }, site);
    expect(html).toContain(block.title);
  });

  it("refuses a block that is not a block as a NonRetryableError, with the reason kept", async () => {
    const { render, NonRetryableError } = await underEdge();
    const failure: unknown = await render(
      standalone,
      { ...variables, block: { ...block, link: "javascript:alert(1)" } },
      site,
    ).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(NonRetryableError);
    expect(failure).toHaveProperty("message", "template_render_failed");
    expect(failure).toHaveProperty("cause.message", "standalone_block_invalid");
  });
});

describe("variables that are not text", () => {
  it("are not interpolated: a placeholder naming one has no value", async () => {
    const row: RenderRow = {
      ...standalone,
      body: [{ type: "paragraph", text: "{{block}}" }],
    };
    await expect(renderTemplate(row, { ...variables, block }, site)).rejects.toThrow(
      "missing_variable:block",
    );
  });

  it("are not checked as addresses, but a text one in a button still is", async () => {
    const off = { ...block, link: "https://example.com/elsewhere" };
    const { html } = await renderTemplate(standalone, { ...variables, block: off }, site);
    expect(html).toContain(`href="${off.link}"`);
    const button: RenderRow = {
      ...standalone,
      body: [{ type: "button", label: "Open", url: "{{url}}" }],
    };
    await expect(renderTemplate(button, { ...variables, url: off.link }, site)).rejects.toThrow(
      "url_off_site",
    );
  });
});

describe("an empty body", () => {
  it("is refused for a key whose template only draws the row's blocks", async () => {
    const row: RenderRow = { key: "received", subject: "Received", preheader: "", body: [] };
    await expect(renderTemplate(row, {}, site)).rejects.toThrow("template_body_invalid");
  });
});
