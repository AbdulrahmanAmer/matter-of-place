import { propertyIdOf } from "../../assets/render-run.ts";
import { stepSpecs } from "../../automation/step-specs.ts";
import { addBlock, assemble } from "../../newsletter/assemble.ts";
import {
  NonRetryableError,
  type JsonObject,
  type StepContext,
  type StepDefinition,
  type StepResult,
} from "../types.ts";

// Step `queue_digest` (B11 Contract): `add` puts the block of an approved asset into the open draft of Place Notes,
// `assemble` builds that draft from what was published since the last issue. The step sends nothing, and both modes
// are safe to repeat: the SQL function keeps one block per asset and the assembly adds only what the draft lacks.

const spec = stepSpecs.queue_digest;

async function run(ctx: StepContext, params: unknown, data: JsonObject): Promise<StepResult> {
  if (spec.paramsSchema.parse(params)["mode"] === "assemble") {
    return { status: "done", result: await assemble(ctx.db, ctx.job.id) };
  }
  // The recipe limits the event to newsletter blocks; a mis-edited recipe must not queue a cover.
  if (data["kind"] !== "newsletter_block") {
    return { status: "done", result: { skipped: "not_newsletter_block" } };
  }
  const assetId = data["asset_id"];
  if (typeof assetId !== "string") throw new NonRetryableError("asset_id_missing");
  await addBlock(ctx.db, propertyIdOf(data), assetId);
  return { status: "done" };
}

export const queueDigest: StepDefinition = {
  type: spec.type,
  heavy: spec.heavy,
  paramsSchema: spec.paramsSchema,
  run,
};
