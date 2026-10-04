import { z } from "zod";
import { AppError } from "../../lib/errors.ts";
import type { StepDefinition } from "../types.ts";
import { dispatchHeavy } from "./heavy.ts";
import { renderSpecs } from "./render-specs.ts";

// A newer set of the static Open Graph cards (G5), started by hand from `scripts/og-static.ts`: the render script
// uploads each card to `og/static/<key>.<hash8>.png` and `onResult` records them in the public settings key `og_static`.

const rendered = z.object({
  files: z.array(
    z.object({
      key: z.string(),
      media_key: z.string(),
      w: z.number().int(),
      h: z.number().int(),
    }),
  ),
});

export const renderOgStatic: StepDefinition<
  z.infer<typeof renderSpecs.render_og_static.paramsSchema>
> = {
  type: "render_og_static",
  ...renderSpecs.render_og_static,
  run: (ctx, params, data) => dispatchHeavy(ctx, { params, data }),
  async onResult(ctx, _job, result) {
    const { files } = rendered.parse(result);
    const value = Object.fromEntries(
      files.map(({ key, media_key, w, h }) => [key, { media_key, w, h }]),
    );
    const { error } = await ctx.db.rpc("set_og_static", { p_value: value });
    if (error !== null) {
      throw new AppError(
        "unavailable",
        undefined,
        "The asset system did not answer (set_og_static).",
      );
    }
  },
};
