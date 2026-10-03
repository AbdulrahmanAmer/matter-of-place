// Job type `render_cover`: the 1200x630 cover, the X crop (1200x675) and the LinkedIn crop (1200x627). Run by
// `scripts/render-job.mjs`, or by hand as `bun scripts/render-cover.mjs --fixture --out <dir>`.
import { createElement } from "react";
import { Cover } from "../src/templates/social/Cover.tsx";
import { renderSet, runCli } from "./lib/shoot.mjs";

/**
 * @param {unknown} job
 * @param {import("./lib/shoot.mjs").RenderOptions} [options]
 */
export function run(job, options) {
  return renderSet(job, options, (spec) => [
    {
      name: "cover",
      role: "main",
      size: { width: 1200, height: 630 },
      element: createElement(Cover, { spec }),
    },
    {
      name: "cover-x",
      role: "x",
      size: { width: 1200, height: 675 },
      element: createElement(Cover, { spec, crop: "x" }),
    },
    {
      // DIRECTION keeps the content between y 6 and y 624, so 3 px of the cover are clipped at the top and bottom.
      name: "cover-linkedin",
      role: "linkedin",
      size: { width: 1200, height: 627 },
      viewport: { width: 1200, height: 630 },
      clip: { x: 0, y: 3 },
      element: createElement(Cover, { spec, crop: "linkedin" }),
    },
  ]);
}

if (import.meta.main) await runCli("cover", run);
