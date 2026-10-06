import { z } from "zod";
import type { Tables } from "../../db/index.ts";
import { assetFileSchema, type AssetKind } from "../../domain/assets.ts";
import { planCarousel } from "../../templates/social/slides.ts";
import { dispatchHeavy } from "../jobs/steps/heavy.ts";
import type { JsonObject, StepContext, StepResult } from "../jobs/types.ts";
import { NonRetryableError } from "../jobs/types.ts";
import { AppError } from "../lib/errors.ts";
import { readVar } from "../lib/runtime-env.ts";
import {
  buildRenderSpec,
  loadMedia,
  loadProperty,
  specHash,
  variantsReady,
  type SpecKind,
  type Variant,
} from "./spec.ts";

// The run and the result of the three render steps, which differ only in the kind they draw (B9 invariants 10 and 12).

const VARIANTS_WAIT_MS = 2 * 60 * 1000;
const VARIANTS_GIVE_UP_MS = 60 * 60 * 1000;
export const DEFAULT_MAX_SLIDES = 8;

const dispatched = z.object({
  asset_id: z.string(),
  spec_hash: z.string(),
});
const rendered = z.object({ files: z.array(assetFileSchema) });
const slideCount = z.object({ max_slides: z.number().int().optional() });

export function unavailable(fn: string): AppError {
  return new AppError("unavailable", undefined, `The asset system did not answer (${fn}).`);
}

/** The revision a manual re-render names in `payload.data`, or null for a recipe job (invariant 3). */
export function revisionOf(data: JsonObject): number | null {
  const revision = data["revision"];
  return typeof revision === "number" && Number.isInteger(revision) && revision >= 1
    ? revision
    : null;
}

export function propertyIdOf(data: JsonObject): string {
  const id = data["property_id"];
  if (typeof id !== "string") throw new NonRetryableError("property_id_missing");
  return id;
}

/**
 * Invariant 10: null once every photograph has `variant` rendered, else the two minute wait; an hour after the step's
 * first stub (`since`, its `created_at`) the job is dead.
 */
export async function waitForVariants(
  ctx: StepContext,
  propertyId: string,
  variant: Variant,
  since: string,
): Promise<StepResult | null> {
  if (await variantsReady(ctx.db, propertyId, variant)) return null;
  if (ctx.now.getTime() - new Date(since).getTime() >= VARIANTS_GIVE_UP_MS) {
    throw new NonRetryableError("variants_missing");
  }
  return {
    status: "retry_at",
    at: new Date(ctx.now.getTime() + VARIANTS_WAIT_MS),
    reason: "variants_pending",
  };
}

/**
 * The slide count the stub holds. `render_carousel` writes its parameter only while the stub has none, so whichever of
 * it and `write_captions` comes first decides, and both plan the same slides.
 */
export async function maxSlides(
  ctx: StepContext,
  assetId: string,
  wanted: number,
): Promise<number> {
  const set = await ctx.db.rpc("set_asset_text", {
    p_asset: assetId,
    p_meta: { max_slides: wanted },
  });
  if (set.error !== null) throw unavailable("set_asset_text");
  const { data, error } = await ctx.db.from("assets").select("meta").eq("id", assetId);
  if (error !== null) throw unavailable("assets");
  return slideCount.safeParse(data[0]?.meta).data?.max_slides ?? wanted;
}

/**
 * The job's asset stub of `kind` (invariant 3), or null for a recipe job whose stub is already approved or published.
 */
export async function openStub(
  ctx: StepContext,
  propertyId: string,
  kind: AssetKind,
  data: JsonObject,
): Promise<Tables<"assets"> | null> {
  const revision = revisionOf(data);
  const stub = await ctx.db.rpc("upsert_asset_stub", {
    p_property: propertyId,
    p_kind: kind,
    p_job_id: ctx.job.id,
    ...(revision === null ? {} : { p_revision: revision }),
  });
  if (stub.error !== null) throw unavailable("upsert_asset_stub");
  const asset = stub.data;
  // Invariant 12: a second publish never overwrites approved work; a changed property gets a new revision through Re-render.
  if (revision === null && (asset.status === "approved" || asset.status === "published")) {
    return null;
  }
  return asset;
}

/**
 * One render step: the state guard, the asset stub, the approved-revision skip, the variants wait, then the dispatch of
 * the spec to render.yml. Nothing here posts, sends or publishes (invariant 1).
 */
export async function runRender(
  ctx: StepContext,
  input: {
    kind: SpecKind;
    variant: Variant;
    params: { max_slides?: number | undefined };
    data: JsonObject;
  },
): Promise<StepResult> {
  const { kind, variant, params, data } = input;
  const propertyId = propertyIdOf(data);
  const property = await loadProperty(ctx.db, propertyId);
  if (property === null) throw new NonRetryableError("property_not_found");
  // R31: a job queued before an unpublish or a takedown draws nothing.
  if (property.editorial_state !== "published") {
    return { status: "done", result: { skipped: "not_published" } };
  }

  const asset = await openStub(ctx, propertyId, kind, data);
  if (asset === null) return { status: "done", result: { skipped: "already_approved" } };

  const wait = await waitForVariants(ctx, propertyId, variant, asset.created_at);
  if (wait !== null) return wait;
  // A deploy defect, not an outage: no spec ever carries a bare key.
  if (readVar("MEDIA_PUBLIC_BASE") === undefined)
    throw new NonRetryableError("media_public_base_missing");

  const base = buildRenderSpec(property, await loadMedia(ctx.db, propertyId), kind, asset.revision);
  const spec =
    kind === "carousel"
      ? {
          ...base,
          slides: planCarousel(
            base,
            await maxSlides(ctx, asset.id, params.max_slides ?? DEFAULT_MAX_SLIDES),
          ),
        }
      : base;
  return dispatchHeavy(
    ctx,
    { params, data },
    {
      spec,
      spec_hash: await specHash(spec),
      revision: asset.revision,
      asset_id: asset.id,
    },
  );
}

/** The callback of a render: the files go to the asset, which clears its `render_error` (invariant 11). */
export async function onRenderResult(
  ctx: StepContext,
  job: StepContext["job"],
  result: unknown,
): Promise<void> {
  const { files } = rendered.parse(result);
  const { asset_id: assetId, spec_hash: hash } = dispatched.parse(job.result);
  const { error } = await ctx.db.rpc("set_asset_files", {
    p_asset: assetId,
    p_files: files,
    p_spec_hash: hash,
  });
  if (error !== null) throw unavailable("set_asset_files");
}
