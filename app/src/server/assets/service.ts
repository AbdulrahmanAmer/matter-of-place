import { z, type ZodIssue } from "zod";
import type { Tables } from "../../db/index.ts";
import {
  adminAssetSchema,
  assetRerenderSchema,
  type AdminAsset,
  type AssetCaptionInput,
  type AssetRejectInput,
} from "../../domain/admin-assets.ts";
import { ADMIN_PAGE_MAX } from "../../domain/admin-page.ts";
import { assetFileSchema, type AssetListFilters } from "../../domain/assets.ts";
import { fanoutEvent } from "../automation/fanout.ts";
import { fromRpcError } from "../lib/admin-errors.ts";
import type { AdminActor } from "../lib/admin-route.ts";
import { auditContext } from "../lib/audit.ts";
import { authorize } from "../lib/authz.ts";
import type { Db } from "../lib/db.ts";
import { AppError } from "../lib/errors.ts";
import { logLine } from "../lib/log.ts";
import { mediaUrl } from "../lib/media-store.ts";
import { loadProperty } from "./spec.ts";
import { lintCaption, type CaptionChannel } from "./voice.ts";

// Screen 10 (B9 step 10): each function is reached only through a `defineAdminRoute` handler, authorizes again
// (SEC-04) and calls exactly one SQL function for a write (B7 invariant 1). Approve and reject plan their event
// right after the commit; a failed plan leaves the event unprocessed for the job runner's sweep.

const COLUMNS =
  "id, property_id, kind, revision, status, caption, alt_text, meta, files, rejection_note, render_error, job_id, approved_at, created_at, updated_at";

type AssetRow = Pick<
  Tables<"assets">,
  | "id"
  | "property_id"
  | "kind"
  | "revision"
  | "status"
  | "caption"
  | "alt_text"
  | "meta"
  | "files"
  | "rejection_note"
  | "render_error"
  | "job_id"
  | "approved_at"
  | "created_at"
  | "updated_at"
>;

const CHANNELS: readonly CaptionChannel[] = ["instagram", "x", "linkedin"];

const filesSchema = z.array(assetFileSchema);
const waitingJobSchema = z.object({ data: z.object({ property_id: z.string() }) });

const notFound = () => new AppError("not_found", undefined, "This asset does not exist.");

/**
 * The properties among `rows` whose null caption waits on a queued `write_captions` job (H34 (2)). Served by
 * `jobs_status_run_after_idx` (status first); type and the payload path are filtered on the queued rows it finds.
 */
async function waitingProperties(db: Db, rows: readonly AssetRow[]): Promise<Set<string>> {
  const ids = [
    ...new Set(rows.filter((row) => row.caption === null).map((row) => row.property_id)),
  ];
  if (ids.length === 0) return new Set();
  const { data, error } = await db
    .from("jobs")
    .select("payload")
    .eq("type", "write_captions")
    .eq("status", "queued")
    .in("payload->data->>property_id", ids);
  if (error !== null) throw fromRpcError(error);
  return new Set(
    data.flatMap((job) => {
      const parsed = waitingJobSchema.safeParse(job.payload);
      return parsed.success ? [parsed.data.data.property_id] : [];
    }),
  );
}

function toAdmin(row: AssetRow, waiting: ReadonlySet<string>): AdminAsset {
  return adminAssetSchema.parse({
    ...row,
    files: filesSchema.parse(row.files).map((file) => ({ ...file, url: mediaUrl(file.media_key) })),
    captions_waiting: row.caption === null && waiting.has(row.property_id),
  });
}

async function planEvent(db: Db, eventId: string): Promise<void> {
  try {
    await fanoutEvent(db, eventId);
  } catch (error) {
    const code = error instanceof AppError ? error.code : "server";
    logLine("warn", "fanout_failed", { eventId, code });
  }
}

/** PostgREST's 416 for an offset past the last match (G-252); `offset = total` still answers an empty page. */
const PAST_LAST_ROW = "PGRST103";

function noCount(): never {
  throw new Error("assets.list answered without a count");
}

/** The rows `filters` matches, counted; `head` drops the rows and keeps the count. */
function matching(db: Db, filters: AssetListFilters, head: boolean) {
  let query = db.from("assets").select(COLUMNS, { count: "exact", head });
  if (filters.status !== undefined) query = query.eq("status", filters.status);
  if (filters.kind !== undefined) query = query.eq("kind", filters.kind);
  if (filters.property_id !== undefined) query = query.eq("property_id", filters.property_id);
  return query;
}

/**
 * `GET /api/admin/assets`: 50 a page in `(status, created_at desc)` order, and the count of every match. Served by
 * `assets_status_created_idx`, or `assets_property_status_idx` with a property; `id` only breaks a tie in time. A page
 * past the last one is empty and still carries the total.
 */
export async function listAssets(
  actor: AdminActor,
  db: Db,
  filters: AssetListFilters,
): Promise<{ items: AdminAsset[]; total: number }> {
  authorize(actor, "assets.list");
  const first = (filters.page - 1) * ADMIN_PAGE_MAX;
  const { data, error, count } = await matching(db, filters, false)
    .order("status")
    .order("created_at", { ascending: false })
    .order("id")
    .range(first, first + ADMIN_PAGE_MAX - 1);
  if (error?.code === PAST_LAST_ROW) {
    const counted = await matching(db, filters, true);
    if (counted.error !== null) throw fromRpcError(counted.error);
    return { items: [], total: counted.count ?? noCount() };
  }
  if (error !== null) throw fromRpcError(error);
  if (count === null) return noCount();
  const waiting = await waitingProperties(db, data);
  return { items: data.map((row) => toAdmin(row, waiting)), total: count };
}

/** `GET /api/admin/assets/:id`. */
export async function getAsset(
  actor: AdminActor,
  db: Db,
  input: { id: string },
): Promise<AdminAsset> {
  authorize(actor, "assets.get");
  const { data, error } = await db.from("assets").select(COLUMNS).eq("id", input.id);
  if (error !== null) throw fromRpcError(error);
  const row = data[0];
  if (row === undefined) throw notFound();
  return toAdmin(row, await waitingProperties(db, [row]));
}

/**
 * `POST /api/admin/assets/:id/approve` through `approve_asset`. An agent key is refused here before any call, as
 * `approve_asset` refuses an agent without evidence; B10 step 4 replaces this refusal with `mayApprove`.
 */
export async function approveAsset(
  actor: AdminActor,
  db: Db,
  input: { id: string },
): Promise<{ asset_id: string; event_id: string }> {
  authorize(actor, "assets.approve");
  if (actor.kind === "agent") {
    throw new AppError("manual_approval", undefined, "A person approves this asset.");
  }
  const { data, error } = await db.rpc("approve_asset", {
    p_asset: input.id,
    ...auditContext(actor),
  });
  if (error !== null) throw fromRpcError(error);
  await planEvent(db, data);
  return { asset_id: input.id, event_id: data };
}

/** `POST /api/admin/assets/:id/reject` through `reject_asset`, which needs the note. */
export async function rejectAsset(
  actor: AdminActor,
  db: Db,
  input: AssetRejectInput,
): Promise<{ asset_id: string; event_id: string }> {
  authorize(actor, "assets.reject");
  const { data, error } = await db.rpc("reject_asset", {
    p_asset: input.id,
    p_note: input.note,
    ...auditContext(actor),
  });
  if (error !== null) throw fromRpcError(error);
  await planEvent(db, data);
  return { asset_id: input.id, event_id: data };
}

/**
 * `POST /api/admin/assets/:id/rerender` through `rerender_asset`: a new pending revision and its job. A second call
 * while that revision is still pending answers the same revision and job.
 */
export async function rerenderAsset(
  actor: AdminActor,
  db: Db,
  input: { id: string },
): Promise<{ asset_id: string; job_id: string | null }> {
  authorize(actor, "assets.re_render");
  const { data, error } = await db.rpc("rerender_asset", {
    p_asset: input.id,
    ...auditContext(actor),
  });
  if (error !== null) throw fromRpcError(error);
  return assetRerenderSchema.parse(data);
}

/** The lint failures of every edited variant, as 422 issues under `captions.<channel>`. */
async function captionIssues(
  db: Db,
  id: string,
  captions: NonNullable<AssetCaptionInput["captions"]>,
): Promise<ZodIssue[]> {
  const { data, error } = await db.from("assets").select("property_id").eq("id", id);
  if (error !== null) throw fromRpcError(error);
  const row = data[0];
  if (row === undefined) throw notFound();
  const property = await loadProperty(db, row.property_id);
  if (property === null) throw notFound();
  return CHANNELS.flatMap((channel) => {
    const text = captions[channel];
    if (text === undefined) return [];
    return lintCaption(text, property, channel).map((issue): ZodIssue => ({
      code: "custom",
      path: ["captions", channel],
      message: issue.message,
    }));
  });
}

/**
 * `PUT /api/admin/assets/:id/caption`: every edited variant passes `lintCaption` first, so `set_asset_caption` only
 * ever stores passing text and marks it `edited`; it also completes the property's queued `write_captions` job.
 */
export async function editCaption(
  actor: AdminActor,
  db: Db,
  input: AssetCaptionInput,
): Promise<{ asset_id: string }> {
  authorize(actor, "assets.caption");
  const { id, captions, alt_text } = input;
  if (captions !== undefined) {
    const issues = await captionIssues(db, id, captions);
    if (issues.length > 0) {
      throw new AppError(
        "caption_lint_failed",
        undefined,
        "The caption does not follow the house voice.",
        issues,
      );
    }
  }
  const { error } = await db.rpc("set_asset_caption", {
    p_asset: id,
    ...auditContext(actor),
    ...(captions === undefined ? {} : { p_captions: captions }),
    ...(alt_text === undefined ? {} : { p_alt_text: alt_text }),
  });
  if (error !== null) throw fromRpcError(error);
  return { asset_id: id };
}
