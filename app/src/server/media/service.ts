import { z } from "zod";
import {
  attachAnswerSchema,
  mediaItemSchema,
  replaceAnswerSchema,
  type MediaItem,
  type StagedUpload,
  type VariantsStatus,
  type altInputSchema,
  type attachInputSchema,
  type mediaIdInputSchema,
  type propertyMediaInputSchema,
  type reorderInputSchema,
  type replaceInputSchema,
  type uploadUrlInputSchema,
} from "../../domain/admin-media";
import { fromRpcError } from "../lib/admin-errors";
import type { AdminActor } from "../lib/admin-route";
import { auditContext } from "../lib/audit";
import { authorize, type ActionId } from "../lib/authz";
import type { Db } from "../lib/db";
import { AppError } from "../lib/errors";
import { createStagingUpload, removeStaged, sniffStaged } from "./staging";

// Screen 9 and the Sequence tab (B7 step 8). Each function authorizes before it touches the database (SEC-04). No
// function here writes the public bucket `media`: uploads are staged in `submissions`, and B9's render_variants
// stores their variants (G25, ruling H33).

const BUCKET = "submissions";
const THUMB_SECONDS = 600;
const JOB_READ_LIMIT = 100;

const storageUnavailable = () =>
  new AppError("storage_unavailable", undefined, "File storage is not answering.");
const invalidImage = () =>
  new AppError("invalid_image", undefined, "The file is not the one this upload was made for.");

/** The action that will save an upload's file: a photograph, a story's image, a market's or a region's. */
const SAVING_ACTION: Readonly<Record<z.output<typeof uploadUrlInputSchema>["scope"], ActionId>> = {
  property: "media.upload_url",
  story: "stories.write",
  market: "markets.edit",
  region: "markets.edit",
};

/** A replace's object name (G54): `staging/<property id>/<media id>.<8 hex>.<extension>`. */
const replacePathOf = (id: string) =>
  new RegExp(`^staging/[0-9a-f-]{36}/${id}\\.[0-9a-f]{8}\\.(?:jpg|png|webp|heic)$`);

const rowSchema = mediaItemSchema.omit({ url: true });
const rowsSchema = z.array(rowSchema);
const statusRowsSchema = z.array(
  z.object({
    id: z.string(),
    staging_path: z.string().nullable(),
    media_key: z.string().nullable(),
    render_job_id: z.string().nullable(),
  }),
);
const jobRowsSchema = z.array(
  z.object({ id: z.string(), type: z.string(), status: z.string(), created_at: z.string() }),
);
const replacedSchema = replaceAnswerSchema.extend({
  previous_staging_path: z.string().nullable(),
});

/** `POST /api/admin/media/upload-url`: the route authorizes `media.upload_url`, this the action that saves the file. */
export async function createUploadUrl(
  actor: AdminActor,
  db: Db,
  input: z.output<typeof uploadUrlInputSchema>,
): Promise<StagedUpload> {
  authorize(actor, "media.upload_url");
  authorize(actor, SAVING_ACTION[input.scope]);
  return createStagingUpload(
    db,
    {
      scope: input.scope,
      target: input.target,
      ...(input.media_id === undefined ? {} : { mediaId: input.media_id }),
    },
    input.mime,
  );
}

/**
 * `POST /api/admin/media/attach`: the staged file is checked (name, then bytes) before the one `attach_media` call,
 * which queues the property's render (G66), so a refused or unreadable file leaves no row.
 */
export async function attachMedia(
  actor: AdminActor,
  db: Db,
  input: z.output<typeof attachInputSchema>,
): Promise<z.infer<typeof attachAnswerSchema>> {
  authorize(actor, "media.attach");
  if (!input.staging_path.startsWith(`staging/${input.property_id}/${input.media_id}.`)) {
    throw invalidImage();
  }
  await sniffStaged(db, input.staging_path);
  const { data, error } = await db.rpc("attach_media", {
    p_media_id: input.media_id,
    p_property_id: input.property_id,
    p_staging_path: input.staging_path,
    ...auditContext(actor),
    ...(input.alt === undefined ? {} : { p_alt: input.alt }),
  });
  if (error !== null) throw fromRpcError(error);
  return attachAnswerSchema.parse(data);
}

/** `GET /api/admin/media?property_id=`: the photographs in order, each with the address the grid shows. */
export async function listMedia(
  actor: AdminActor,
  db: Db,
  input: z.output<typeof propertyMediaInputSchema>,
): Promise<{ items: MediaItem[] }> {
  authorize(actor, "media.list");
  const { data, error } = await db
    .from("property_media")
    .select("id, sort_order, alt, orientation, media_key, staging_path")
    .eq("property_id", input.property_id)
    .order("sort_order")
    .order("id");
  if (error !== null) throw fromRpcError(error);
  const rows = rowsSchema.parse(data);
  const staged = rows.flatMap((row) =>
    row.media_key === null && row.staging_path !== null ? [row.staging_path] : [],
  );
  const signed = new Map<string, string>();
  if (staged.length > 0) {
    const answer = await db.storage.from(BUCKET).createSignedUrls(staged, THUMB_SECONDS);
    if (answer.error !== null) throw storageUnavailable();
    for (const entry of answer.data) {
      if (entry.path !== null && entry.signedUrl !== null) signed.set(entry.path, entry.signedUrl);
    }
  }
  return {
    items: rows.map((row) => ({
      ...row,
      url:
        row.media_key === null
          ? (signed.get(row.staging_path ?? "") ?? null)
          : `/media/${row.media_key}`,
    })),
  };
}

/** `POST /api/admin/media/reorder`: one statement, so the catalog version moves once (F25 a). */
export async function reorderMedia(
  actor: AdminActor,
  db: Db,
  input: z.output<typeof reorderInputSchema>,
): Promise<{ count: number }> {
  authorize(actor, "media.reorder");
  const { data, error } = await db.rpc("reorder_media", {
    p_property_id: input.property_id,
    p_order: input.order,
    ...auditContext(actor),
  });
  if (error !== null) throw fromRpcError(error);
  return { count: data };
}

/** `PATCH /api/admin/media/:id`: the alt text, empty to clear it. */
export async function setMediaAlt(
  actor: AdminActor,
  db: Db,
  input: z.output<typeof altInputSchema>,
): Promise<{ id: string }> {
  authorize(actor, "media.alt");
  const { error } = await db.rpc("set_media_alt", {
    p_media_id: input.id,
    p_alt: input.alt,
    ...auditContext(actor),
  });
  if (error !== null) throw fromRpcError(error);
  return { id: input.id };
}

/**
 * `POST /api/admin/media/:id/replace`: the new file is staged beside the old one under a fresh suffix (G54); the row
 * keeps its key and variants until the render stores the new ones, and the previous staged file, if any, is removed.
 */
export async function replaceMedia(
  actor: AdminActor,
  db: Db,
  input: z.output<typeof replaceInputSchema>,
): Promise<z.infer<typeof replaceAnswerSchema>> {
  authorize(actor, "media.replace");
  if (!replacePathOf(input.id).test(input.staging_path)) throw invalidImage();
  await sniffStaged(db, input.staging_path);
  const { data, error } = await db.rpc("replace_media", {
    p_media_id: input.id,
    p_staging_path: input.staging_path,
    ...auditContext(actor),
  });
  if (error !== null) throw fromRpcError(error);
  const replaced = replacedSchema.parse(data);
  if (
    replaced.previous_staging_path !== null &&
    replaced.previous_staging_path !== input.staging_path
  ) {
    await removeStaged(db, replaced.previous_staging_path);
  }
  return { render_job_id: replaced.render_job_id };
}

/** `DELETE /api/admin/media/:id`: refused on a published property or while an asset uses it; the staged file goes too. */
export async function deleteMedia(
  actor: AdminActor,
  db: Db,
  input: z.output<typeof mediaIdInputSchema>,
): Promise<{ id: string }> {
  authorize(actor, "media.delete");
  const { data, error } = await db.rpc("delete_media", {
    p_media_id: input.id,
    ...auditContext(actor),
  });
  if (error !== null) throw fromRpcError(error);
  const staged = z.string().nullable().parse(data);
  if (staged !== null) await removeStaged(db, staged);
  return { id: input.id };
}

type JobRow = z.infer<typeof jobRowsSchema>[number];

/** The state a staged row's job gives it; `uploading` is the browser's own, before attach answers. */
function stagedState(job: JobRow | undefined): VariantsStatus["items"][number]["state"] {
  if (job === undefined) return "staged";
  if (job.status === "queued" || job.status === "running") return "processing";
  if (job.status === "failed" || job.status === "dead") return "failed";
  return "staged";
}

/**
 * `GET /api/admin/media/variants-status?property_id=`: two reads. A stored row is ready; a staged row takes the state
 * of the job that claimed it (PERF-01), else of the property's newest render job, else of its copy job.
 */
export async function variantsStatus(
  actor: AdminActor,
  db: Db,
  propertyId: string,
): Promise<VariantsStatus> {
  authorize(actor, "media.variants_status");
  const [media, jobs] = await Promise.all([
    db
      .from("property_media")
      .select("id, staging_path, media_key, render_job_id")
      .eq("property_id", propertyId),
    db
      .from("jobs")
      .select("id, type, status, created_at")
      .in("type", ["render_variants", "copy_submission_media"])
      .eq("payload->data->>property_id", propertyId)
      .order("created_at", { ascending: false })
      .limit(JOB_READ_LIMIT),
  ]);
  if (media.error !== null) throw fromRpcError(media.error);
  if (jobs.error !== null) throw fromRpcError(jobs.error);
  const found = jobRowsSchema.parse(jobs.data);
  const newest = (type: string) => found.find((job) => job.type === type);
  return {
    items: statusRowsSchema.parse(media.data).map((row) => {
      if (row.staging_path === null) return { media_id: row.id, state: "ready", job_id: null };
      const job =
        found.find((candidate) => candidate.id === row.render_job_id) ??
        newest("render_variants") ??
        newest("copy_submission_media");
      const state = stagedState(job);
      return { media_id: row.id, state, job_id: state === "failed" ? (job?.id ?? null) : null };
    }),
  };
}
