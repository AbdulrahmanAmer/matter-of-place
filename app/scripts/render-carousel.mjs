// Job type `render_carousel`: the 1080x1350 slides and the 1080x1080 LinkedIn set. Run by `scripts/render-job.mjs`,
// or by hand as `bun scripts/render-carousel.mjs --fixture --out <dir>`.
import { createElement } from "react";
import { CarouselSlide } from "../src/templates/social/Carousel.tsx";
import { planCarousel, planLinkedInSet } from "../src/templates/social/slides.ts";
import { renderSet, runCli } from "./lib/shoot.mjs";

const SLIDE = { width: 1080, height: 1350 };
// The square keeps the top 1080 px of a slide: the photograph and the first line of the band (wordmark, marker and
// location). A set slide is drawn as a photo slide, so no headline is cut by the crop.
const SQUARE = { width: 1080, height: 1080 };

/**
 * @param {unknown} job
 * @param {import("./lib/shoot.mjs").RenderOptions} [options]
 */
export function run(job, options) {
  return renderSet(job, options, (spec) => {
    const slides = spec.slides ?? planCarousel(spec);
    const set = planLinkedInSet(spec);
    return [
      ...slides.map((slide, index) => ({
        name: `slide-${String(index)}`,
        role: "slide",
        index,
        size: SLIDE,
        element: createElement(CarouselSlide, { spec, slide, index, total: slides.length }),
      })),
      ...set.map(({ image }, index) => ({
        name: `linkedin-set-${String(index)}`,
        role: "linkedin_set",
        index,
        size: SQUARE,
        viewport: SLIDE,
        clip: { x: 0, y: 0 },
        element: createElement(CarouselSlide, {
          spec,
          slide: { kind: "photo", image },
          index,
          total: set.length,
        }),
      })),
    ];
  });
}

if (import.meta.main) await runCli("carousel", run);
