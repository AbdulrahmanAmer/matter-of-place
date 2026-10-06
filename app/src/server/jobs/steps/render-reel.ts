import { z } from "zod";
import { assetFileSchema } from "../../../domain/assets.ts";
import { buildReelSpec } from "../../assets/reel-spec.ts";
import { openStub, propertyIdOf, unavailable, waitForVariants } from "../../assets/render-run.ts";
import { loadMedia, loadProperty, specHash } from "../../assets/spec.ts";
import { stepSpecs } from "../../automation/step-specs.ts";
import type { JsonObject, StepContext, StepDefinition, StepResult } from "../types.ts";
import { NonRetryableError } from "../types.ts";
import { dispatchHeavy } from "./heavy.ts";

// Step `render_reel` (B12): the vertical film of a Campaign property, rendered by render.yml's `reel` job. The step
// never posts and never approves: its result waits on screen 10 as a pending asset (invariant 8).

const spec = stepSpecs.render_reel;
const CAMERA_SHOTS = 4;

const dispatched = z.object({ asset_id: z.string(), spec_hash: z.string() });
const rendered = z.object({
  files: z.array(assetFileSchema),
  meta: z.object({
    duration_s: z.number(),
    fps: z.number(),
    gate: z.record(z.string(), z.number().nullable()),
  }),
});

async function run(ctx: StepContext, params: unknown, data: JsonObject): Promise<StepResult> {
  const propertyId = propertyIdOf(data);
  const property = await loadProperty(ctx.db, propertyId);
  if (property === null) throw new NonRetryableError("property_not_found");
  // Invariant 1 (S24): the row decides, whatever tier the recipe or the event names.
  if (property.campaign_tier !== "Campaign") throw new NonRetryableError("not_campaign");
  if (property.editorial_state !== "published") throw new NonRetryableError("not_published");

  // A second publish never overwrites approved work; a new reel comes only through Re-render.
  const asset = await openStub(ctx, propertyId, "reel", data);
  if (asset === null) return { status: "done", result: { skipped: "already_approved" } };

  if ((await loadMedia(ctx.db, propertyId)).length < CAMERA_SHOTS) {
    throw new NonRetryableError("too_few_photos");
  }
  const wait =
    (await waitForVariants(ctx, propertyId, "hero", asset.created_at)) ??
    (await waitForVariants(ctx, propertyId, "carousel", asset.created_at));
  if (wait !== null) return wait;

  // Read after the wait, so every photograph carries the stripped copy its variants were made from.
  const reel = buildReelSpec(property, await loadMedia(ctx.db, propertyId));
  return dispatchHeavy(
    ctx,
    { params: spec.paramsSchema.parse(params), data },
    {
      spec: reel,
      spec_hash: await specHash(reel),
      revision: asset.revision,
      asset_id: asset.id,
    },
  );
}

/** The callback: the two files and the render's numbers go to the asset; status, caption and alt text stay. */
async function onResult(ctx: StepContext, job: StepContext["job"], result: unknown): Promise<void> {
  const { files, meta } = rendered.parse(result);
  const { asset_id: assetId, spec_hash: hash } = dispatched.parse(job.result);
  const stored = await ctx.db.rpc("set_asset_files", {
    p_asset: assetId,
    p_files: files,
    p_spec_hash: hash,
  });
  if (stored.error !== null) throw unavailable("set_asset_files");
  // No caption and no alt text: the stored ones, which write_captions owns, stay.
  const text = await ctx.db.rpc("set_asset_text", { p_asset: assetId, p_meta: meta });
  if (text.error !== null) throw unavailable("set_asset_text");
}

export const renderReel: StepDefinition = {
  type: spec.type,
  heavy: spec.heavy,
  paramsSchema: spec.paramsSchema,
  run,
  onResult,
};
