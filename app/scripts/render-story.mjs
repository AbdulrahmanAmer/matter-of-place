// Job type `render_story`: the 1080x1920 story. Run by `scripts/render-job.mjs`, or by hand as
// `bun scripts/render-story.mjs --fixture --out <dir>`.
import { createElement } from "react";
import { Story } from "../src/templates/social/Story.tsx";
import { renderSet, runCli } from "./lib/shoot.mjs";

/**
 * @param {unknown} job
 * @param {import("./lib/shoot.mjs").RenderOptions} [options]
 */
export function run(job, options) {
  return renderSet(job, options, (spec) => [
    {
      name: "story",
      role: "main",
      size: { width: 1080, height: 1920 },
      element: createElement(Story, { spec }),
    },
  ]);
}

if (import.meta.main) await runCli("story", run);
