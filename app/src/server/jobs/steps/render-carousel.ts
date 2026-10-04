import type { z } from "zod";
import { onRenderResult, runRender } from "../../assets/render-run.ts";
import type { StepDefinition } from "../types.ts";
import { renderSpecs } from "./render-specs.ts";

// The carousel of 6 to 8 slides and the LinkedIn square set; `max_slides` is the recipe's parameter (G18).
export const renderCarousel: StepDefinition<
  z.infer<typeof renderSpecs.render_carousel.paramsSchema>
> = {
  type: "render_carousel",
  ...renderSpecs.render_carousel,
  run: (ctx, params, data) =>
    runRender(ctx, { kind: "carousel", variant: "carousel", params, data }),
  onResult: onRenderResult,
};
