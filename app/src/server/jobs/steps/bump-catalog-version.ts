import { stepSpecs } from "../../automation/step-specs.ts";
import type { JsonObject, StepContext, StepDefinition, StepResult } from "../types.ts";
import { NonRetryableError } from "../types.ts";

// Refreshes the catalog after a publication (B8b Files). Both calls are safe to repeat: an open market stays open and
// an extra bump only renews caches. The step reads and writes no table itself (G43, architecture 13 rule 4).

const spec = stepSpecs.bump_catalog_version;

/** Opens the market of a published property; the slug of a market it opened, none when nothing changed. */
async function openMarket(ctx: StepContext, data: JsonObject): Promise<string[]> {
  const propertyId = data["property_id"];
  if (typeof propertyId !== "string") throw new NonRetryableError("property_id_missing");
  const { data: slug, error } = await ctx.db.rpc("open_market_on_publish", {
    p_property_id: propertyId,
    p_notify: true,
  });
  if (error !== null) throw new Error(`open_market_on_publish_failed:${error.code}`);
  return typeof slug === "string" ? [slug] : [];
}

async function run(ctx: StepContext, params: unknown, data: JsonObject): Promise<StepResult> {
  const opened =
    spec.paramsSchema.parse(params)["flip_coming_soon"] === true ? await openMarket(ctx, data) : [];
  const { error } = await ctx.db.rpc("bump_catalog_version");
  if (error !== null) throw new Error(`bump_catalog_version_failed:${error.code}`);
  return { status: "done", result: { markets_opened: opened } };
}

export const bumpCatalogVersion: StepDefinition = {
  type: spec.type,
  heavy: spec.heavy,
  paramsSchema: spec.paramsSchema,
  run,
};
