import { z } from "zod";
import type { Tables } from "../../../db/index.ts";
import type { AssetKind } from "../../../domain/assets.ts";
import { planCarousel } from "../../../templates/social/slides.ts";
import { loadCaptionModel, writeCaptions, type Completion } from "../../assets/captions.ts";
import {
  DEFAULT_MAX_SLIDES,
  maxSlides,
  propertyIdOf,
  unavailable,
  waitForVariants,
} from "../../assets/render-run.ts";
import { buildRenderSpec, loadMedia, loadProperty } from "../../assets/spec.ts";
import { maybeAutoApprove } from "../../channels/auto-approve.ts";
import type { JsonObject, StepContext, StepDefinition, StepResult } from "../types.ts";
import { NonRetryableError } from "../types.ts";
import { renderSpecs } from "./render-specs.ts";

// The captions and alt texts of every kind a property produces, written through the operator's Claude account on his
// laptop (ASSUMED H34). The registry module is `local`: the job runner never runs it, `scripts/captions-runner.ts`
// calls `runWriteCaptions`. Nothing here posts, sends or publishes (invariant 1).

const TIER_KINDS: readonly AssetKind[] = ["cover", "carousel", "story", "newsletter_block"];
const CAMPAIGN_KINDS: readonly AssetKind[] = ["reel", "standalone_email"];
// The kinds a post step publishes and the system may approve; a reel is Campaign only, which is never automatic.
const AUTO_KINDS: readonly AssetKind[] = ["cover", "carousel", "story"];

export type CliComplete = (
  prompt: string,
  model: string,
  signal: AbortSignal,
) => Promise<Completion>;

const carouselJob = z.object({
  params: z.object({ max_slides: z.number().int().optional() }),
});
const lintState = z.object({ caption_lint: z.string().optional() });

/** `max_slides` of the `render_carousel` job of the same event, which the render plans its slides from. */
async function requestedSlides(ctx: StepContext): Promise<number> {
  if (ctx.job.eventId === null) return DEFAULT_MAX_SLIDES;
  const { data, error } = await ctx.db
    .from("jobs")
    .select("payload")
    .eq("event_id", ctx.job.eventId)
    .eq("type", "render_carousel");
  if (error !== null) throw unavailable("jobs");
  return carouselJob.safeParse(data[0]?.payload).data?.params.max_slides ?? DEFAULT_MAX_SLIDES;
}

/** The rows an editor typed while the model was answering: `set_asset_caption` does not stop a running job (H34 (5)). */
async function typedByHand(ctx: StepContext, stubs: Tables<"assets">[]): Promise<Set<string>> {
  const { data, error } = await ctx.db
    .from("assets")
    .select("id, meta")
    .in(
      "id",
      stubs.map((stub) => stub.id),
    );
  if (error !== null) throw unavailable("assets");
  return new Set(
    data
      .filter((row) => lintState.safeParse(row.meta).data?.caption_lint === "edited")
      .map((row) => row.id),
  );
}

/** Invariants 7, 10 and 12 and H34 (5): the stubs, the skips, the wait, then one `set_asset_text` per kind. */
export async function runWriteCaptions(
  ctx: StepContext,
  params: { alt_text?: boolean | undefined },
  payload: JsonObject,
  complete: CliComplete,
): Promise<StepResult> {
  const propertyId = propertyIdOf(payload);
  const property = await loadProperty(ctx.db, propertyId);
  if (property === null) throw new NonRetryableError("property_not_found");
  if (property.editorial_state !== "published") {
    return { status: "done", result: { skipped: "not_published" } };
  }

  // Tier gate, re-checked here so a mis-edited recipe cannot create a Campaign kind (invariant 7).
  const kinds =
    property.campaign_tier === "Campaign" ? [...TIER_KINDS, ...CAMPAIGN_KINDS] : TIER_KINDS;
  const stubs: Tables<"assets">[] = [];
  for (const kind of kinds) {
    const stub = await ctx.db.rpc("upsert_asset_stub", { p_property: propertyId, p_kind: kind });
    if (stub.error !== null) throw unavailable("upsert_asset_stub");
    stubs.push(stub.data);
  }

  const open = stubs.filter((stub) => stub.status !== "approved" && stub.status !== "published");
  if (open.length === 0) return { status: "done", result: { skipped: "already_approved" } };
  const writing = open.filter(
    (stub) =>
      stub.kind !== "standalone_email" &&
      lintState.safeParse(stub.meta).data?.caption_lint !== "edited",
  );
  if (writing.length === 0) return { status: "done", result: { skipped: "caption_edited" } };

  const since = new Date(Math.min(...writing.map((stub) => Date.parse(stub.created_at))));
  const wait = await waitForVariants(ctx, propertyId, "carousel", since.toISOString());
  if (wait !== null) return wait;

  const carousel = stubs.find((stub) => stub.kind === "carousel");
  if (carousel === undefined) throw new NonRetryableError("carousel_stub_missing");
  const base = buildRenderSpec(
    property,
    await loadMedia(ctx.db, propertyId),
    "carousel",
    carousel.revision,
  );
  const spec = {
    ...base,
    slides: planCarousel(base, await maxSlides(ctx, carousel.id, await requestedSlides(ctx))),
  };
  const model = await loadCaptionModel(ctx.db);
  const written = await writeCaptions(property, spec, {
    complete: (prompt, signal) => complete(prompt, model, signal),
    model,
    signal: ctx.signal,
  });

  const { instagram, x, linkedin, alt_text: altText, slide_alts: slideAlts } = written.captions;
  const withAlt = params.alt_text !== false;
  const edited = await typedByHand(ctx, writing);
  const updatedAssetIds: string[] = [];
  for (const stub of writing) {
    if (edited.has(stub.id)) continue;
    // The newsletter block holds only the alt text of its image; its copy is `build_newsletter_block`'s.
    if (stub.kind === "newsletter_block" && !withAlt) continue;
    const { error } = await ctx.db.rpc(
      "set_asset_text",
      stub.kind === "newsletter_block"
        ? { p_asset: stub.id, p_alt_text: altText }
        : {
            p_asset: stub.id,
            p_caption: instagram,
            ...(withAlt ? { p_alt_text: altText } : {}),
            p_meta: {
              captions: { instagram, x, linkedin },
              caption_lint: written.caption_lint,
              ...(stub.kind === "carousel" && withAlt ? { slide_alts: slideAlts } : {}),
            },
          },
    );
    if (error !== null) throw unavailable("set_asset_text");
    if (AUTO_KINDS.includes(stub.kind)) updatedAssetIds.push(stub.id);
  }
  // B10 invariant 4a: a social asset this run completed may go out without a person, if its tier's mode allows it.
  for (const id of updatedAssetIds) await maybeAutoApprove(ctx.db, id, ctx.now);
  return { status: "done", result: { usage: written.usage } };
}

export const writeCaptionsStep: StepDefinition<
  z.infer<typeof renderSpecs.write_captions.paramsSchema>
> = {
  type: "write_captions",
  ...renderSpecs.write_captions,
  run: () => Promise.reject(new NonRetryableError("local_step")),
};
