import { z } from "zod";
import type { Db } from "../../lib/db.ts";
import { AppError } from "../../lib/errors.ts";
import { buckets, storageUnavailable } from "../../lib/media-store.ts";
import { loadMedia, loadProperty } from "../../assets/spec.ts";
import type { JsonObject, StepContext, StepDefinition, StepResult } from "../types.ts";
import { NonRetryableError } from "../types.ts";
import { dispatchHeavy } from "./heavy.ts";
import { renderSpecs } from "./render-specs.ts";

// The sizes of every staged photograph (G25, ruling H3): the original arrives in the private bucket `submissions`
// under `staging/`, the render script stores the stripped copy and five sizes in `media`, and `onResult` records the
// keys and deletes the staged file. A property job claims its rows through `claim_media_for_render`, so each staged
// row goes to exactly one job; a target job renders the one image of a story, market or region.

const SIGNED_SECONDS = 2 * 60 * 60;
const STAGING = "staging/";
const MIME_OF: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
};

const targetData = z.object({
  target: z.enum(["story", "market", "region"]),
  slug: z.string().min(1),
  staging_path: z.string(),
});
const signedItem = z.object({
  media_id: z.string(),
  staging_path: z.string(),
  staged_url: z.string(),
  mime: z.string(),
  owner: z.string(),
  n: z.number().int(),
});
const sizes = z.record(z.string(), z.object({ w: z.number(), h: z.number() }));
const dispatchedMedia = z.object({ media: z.array(signedItem) });
const producedMedia = z.object({
  media: z.record(z.string(), z.object({ media_key: z.string(), variants: sizes })),
});
const applied = z.array(
  z.object({ media_id: z.string(), staging_path: z.string(), stored: z.boolean() }),
);

function unavailable(what: string): AppError {
  return new AppError("unavailable", undefined, `The ${what} did not answer.`);
}

function mimeOf(path: string): string {
  const mime = MIME_OF[path.slice(path.lastIndexOf(".") + 1).toLowerCase()];
  if (mime === undefined) throw new NonRetryableError("unsupported_media_type");
  return mime;
}

/** One call for every path: the Actions job reads a staged original only through these two-hour addresses. */
async function sign(ctx: StepContext, paths: string[]): Promise<string[]> {
  const { data, error } = await ctx.db.storage
    .from(buckets.submissions)
    .createSignedUrls(paths, SIGNED_SECONDS);
  if (error !== null) throw storageUnavailable();
  return data.map((entry) => {
    if (entry.error !== null || entry.signedUrl === null) throw unavailable("staged original");
    return entry.signedUrl;
  });
}

async function targetExists(
  db: Db,
  target: "story" | "market" | "region",
  slug: string,
): Promise<boolean> {
  const answer =
    target === "story"
      ? await db.from("stories").select("slug").eq("slug", slug)
      : target === "market"
        ? await db.from("markets").select("slug").eq("slug", slug)
        : await db.from("regions").select("slug").eq("slug", slug);
  if (answer.error !== null) throw unavailable(`${target} read`);
  return answer.data.length > 0;
}

async function runTarget(
  ctx: StepContext,
  params: JsonObject,
  data: JsonObject,
): Promise<StepResult> {
  const parsed = targetData.safeParse(data);
  if (!parsed.success) throw new NonRetryableError("invalid_target");
  const { target, slug, staging_path: stagingPath } = parsed.data;
  if (!stagingPath.startsWith(STAGING)) throw new NonRetryableError("invalid_staging_path");
  if (!(await targetExists(ctx.db, target, slug))) throw new NonRetryableError("target_not_found");
  const [stagedUrl] = await sign(ctx, [stagingPath]);
  const media = [
    {
      media_id: `${target}:${slug}`,
      staging_path: stagingPath,
      staged_url: stagedUrl ?? "",
      mime: mimeOf(stagingPath),
      owner: slug,
      n: 0,
    },
  ];
  return dispatchHeavy(ctx, { params, data }, { media });
}

async function runProperty(
  ctx: StepContext,
  params: JsonObject,
  data: JsonObject,
): Promise<StepResult> {
  const propertyId = data["property_id"];
  if (typeof propertyId !== "string") throw new NonRetryableError("property_id_missing");
  const property = await loadProperty(ctx.db, propertyId);
  if (property === null) throw new NonRetryableError("property_not_found");

  const claim = await ctx.db.rpc("claim_media_for_render", {
    p_property_id: propertyId,
    p_job_id: ctx.job.id,
  });
  if (claim.error !== null) throw unavailable("media claim");
  const claimed = claim.data.flatMap((row) =>
    row.staging_path === null
      ? []
      : [{ id: row.id, path: row.staging_path, order: row.sort_order }],
  );
  if (claimed.length === 0) {
    const stillStaged = (await loadMedia(ctx.db, propertyId)).some(
      (row) => row.staging_path !== null,
    );
    return {
      status: "done",
      result: { skipped: stillStaged ? "claimed_elsewhere" : "nothing_staged" },
    };
  }

  // STUB(B7 step 8): at 40 claimed rows one request_property_render(p_property_id) call queues the next job for the rows beyond; the function and its generated type come with B7's migration
  const urls = await sign(
    ctx,
    claimed.map(({ path }) => path),
  );
  const media = claimed.map(({ id, path, order }, index) => ({
    media_id: id,
    staging_path: path,
    staged_url: urls[index] ?? "",
    mime: mimeOf(path),
    owner: property.slug,
    n: order,
  }));
  return dispatchHeavy(ctx, { params, data }, { media });
}

/** Three calls whatever the number of photographs (JOB-03): one record, one removal, one clear. */
async function recordProperty(
  ctx: StepContext,
  signed: z.infer<typeof signedItem>[],
  produced: z.infer<typeof producedMedia>["media"],
): Promise<void> {
  const items = signed.map((item) => {
    const made = produced[item.media_id];
    if (made === undefined) throw new Error(`render_variants: no result for ${item.media_id}`);
    return {
      media_id: item.media_id,
      staging_path: item.staging_path,
      media_key: made.media_key,
      variants: made.variants,
    };
  });
  const record = await ctx.db.rpc("apply_media_variants", { p_items: items });
  if (record.error !== null) throw unavailable("variants record");
  const stored = applied.parse(record.data).filter((item) => item.stored);

  // A staged file goes only after its keys are stored; one whose row moved to a newer path goes too (nothing needs it).
  const removal = await ctx.db.storage
    .from(buckets.submissions)
    .remove(signed.map(({ staging_path }) => staging_path));
  if (removal.error !== null) throw storageUnavailable();

  if (stored.length > 0) {
    const cleared = await ctx.db.rpc("clear_media_staging", {
      p_items: stored.map(({ media_id, staging_path }) => ({ media_id, staging_path })),
    });
    if (cleared.error !== null) throw unavailable("staging clear");
  }
}

async function recordTarget(
  ctx: StepContext,
  item: z.infer<typeof signedItem>,
  produced: z.infer<typeof producedMedia>["media"],
): Promise<void> {
  const [target, ...rest] = item.media_id.split(":");
  const made = produced[item.media_id];
  if (made === undefined) throw new Error(`render_variants: no result for ${item.media_id}`);
  const set = await ctx.db.rpc("set_target_image", {
    p_target: target ?? "",
    p_slug: rest.join(":"),
    p_image: made.media_key,
    p_variants: made.variants,
  });
  if (set.error !== null) throw unavailable("target image");
  const removal = await ctx.db.storage.from(buckets.submissions).remove([item.staging_path]);
  if (removal.error !== null) throw storageUnavailable();
}

export const renderVariants: StepDefinition<
  z.infer<typeof renderSpecs.render_variants.paramsSchema>
> = {
  type: "render_variants",
  ...renderSpecs.render_variants,
  run: (ctx, params, data) =>
    data["target"] === undefined ? runProperty(ctx, params, data) : runTarget(ctx, params, data),
  async onResult(ctx, job, result) {
    const { media: signed } = dispatchedMedia.parse(job.result);
    const { media: produced } = producedMedia.parse(result);
    const [first] = signed;
    if (first === undefined) return;
    if (first.media_id.includes(":")) await recordTarget(ctx, first, produced);
    else await recordProperty(ctx, signed, produced);
  },
};
