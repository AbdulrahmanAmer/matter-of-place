import type { z } from "zod";
import type { Tables } from "../../../db/index.ts";
import { firstSentence } from "../../../templates/social/slides.ts";
import { propertyLink } from "../../assets/links.ts";
import { propertyIdOf, revisionOf, unavailable, waitForVariants } from "../../assets/render-run.ts";
import { loadMedia, loadProperty, variantKey } from "../../assets/spec.ts";
import { mediaUrl } from "../../lib/media-store.ts";
import { readVar } from "../../lib/runtime-env.ts";
import type { JsonObject, StepContext, StepDefinition, StepResult } from "../types.ts";
import { NonRetryableError } from "../types.ts";
import { renderSpecs } from "./render-specs.ts";

// The newsletter block and, for the Campaign tier, the standalone email, built from the property row and the `og`
// variant of its hero. No browser: B11 renders the block with the email templates. Nothing here sends (invariant 1).

type EmailKind = "newsletter_block" | "standalone_email";

function kindsOf(tier: string, requested: unknown): EmailKind[] {
  // Tier gate, re-checked here so a mis-edited recipe cannot create a standalone email (invariant 7).
  const tierKinds: EmailKind[] =
    tier === "Campaign" ? ["newsletter_block", "standalone_email"] : ["newsletter_block"];
  return requested === undefined ? tierKinds : tierKinds.filter((kind) => kind === requested);
}

async function run(ctx: StepContext, _params: unknown, data: JsonObject): Promise<StepResult> {
  const propertyId = propertyIdOf(data);
  const property = await loadProperty(ctx.db, propertyId);
  if (property === null) throw new NonRetryableError("property_not_found");
  if (property.editorial_state !== "published") {
    return { status: "done", result: { skipped: "not_published" } };
  }
  // A job from `rerender_asset` names its kind and revision and never touches the other kind (invariant 3).
  const kinds = kindsOf(property.campaign_tier, data["kind"]);
  if (kinds.length === 0) return { status: "done", result: { skipped: "kind_not_built" } };

  const revision = revisionOf(data);
  const stubs: Tables<"assets">[] = [];
  for (const kind of kinds) {
    const stub = await ctx.db.rpc("upsert_asset_stub", {
      p_property: propertyId,
      p_kind: kind,
      p_job_id: ctx.job.id,
      ...(revision === null ? {} : { p_revision: revision }),
    });
    if (stub.error !== null) throw unavailable("upsert_asset_stub");
    stubs.push(stub.data);
  }
  // Invariant 12: a second publish never overwrites approved work; only a re-render names a revision.
  const open = stubs.filter(
    (stub) => revision !== null || (stub.status !== "approved" && stub.status !== "published"),
  );
  if (open.length === 0) return { status: "done", result: { skipped: "already_approved" } };

  const since = new Date(Math.min(...open.map((stub) => Date.parse(stub.created_at))));
  const wait = await waitForVariants(ctx, propertyId, "og", since.toISOString());
  if (wait !== null) return wait;
  // A deploy defect, not an outage: no block ever holds a bare key as its address.
  if (readVar("MEDIA_PUBLIC_BASE") === undefined) {
    throw new NonRetryableError("media_public_base_missing");
  }

  const hero = (await loadMedia(ctx.db, propertyId)).find((row) => row.media_key !== null);
  if (hero === undefined || hero.media_key === null) throw new NonRetryableError("hero_missing");
  const imageKey = variantKey(hero.media_key, "og");
  const place = (property.place ?? "").trim();
  const block = {
    title: property.title,
    deck: place === "" ? `${property.city}, ${property.state}` : firstSentence(place),
    image_key: imageKey,
    image_url: mediaUrl(imageKey, { absolute: true }),
    link: propertyLink(property.slug, "newsletter"),
  };
  for (const stub of open) {
    const { error } = await ctx.db.rpc("set_asset_text", {
      p_asset: stub.id,
      p_meta:
        stub.kind === "standalone_email"
          ? { block, subject: block.title, preheader: block.deck }
          : { block },
    });
    if (error !== null) throw unavailable("set_asset_text");
  }
  return { status: "done" };
}

export const buildNewsletterBlock: StepDefinition<
  z.infer<typeof renderSpecs.build_newsletter_block.paramsSchema>
> = {
  type: "build_newsletter_block",
  ...renderSpecs.build_newsletter_block,
  run,
};
