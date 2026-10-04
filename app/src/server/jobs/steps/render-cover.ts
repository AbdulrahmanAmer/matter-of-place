import type { z } from "zod";
import { onRenderResult, runRender } from "../../assets/render-run.ts";
import type { StepDefinition } from "../types.ts";
import { renderSpecs } from "./render-specs.ts";

// The cover with its X and LinkedIn crops: the Open Graph size of every photograph is the source (invariant 10).
export const renderCover: StepDefinition<z.infer<typeof renderSpecs.render_cover.paramsSchema>> = {
  type: "render_cover",
  ...renderSpecs.render_cover,
  run: (ctx, params, data) => runRender(ctx, { kind: "cover", variant: "og", params, data }),
  onResult: onRenderResult,
};
