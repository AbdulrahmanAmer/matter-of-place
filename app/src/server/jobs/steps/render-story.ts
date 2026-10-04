import type { z } from "zod";
import { onRenderResult, runRender } from "../../assets/render-run.ts";
import type { StepDefinition } from "../types.ts";
import { renderSpecs } from "./render-specs.ts";

export const renderStory: StepDefinition<z.infer<typeof renderSpecs.render_story.paramsSchema>> = {
  type: "render_story",
  ...renderSpecs.render_story,
  run: (ctx, params, data) => runRender(ctx, { kind: "story", variant: "carousel", params, data }),
  onResult: onRenderResult,
};
