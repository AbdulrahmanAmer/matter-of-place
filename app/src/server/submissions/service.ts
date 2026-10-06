import { z } from "zod";
import {
  currentRightsVersion,
  submissionUploadsSchema,
  type Receipt,
  type Submission,
} from "../../domain/contracts";
import {
  savedViews,
  submissionListRowSchema,
  type ListSubmissionsInput,
  type SubmissionListRow,
  type startReviewInputSchema,
} from "../../domain/admin-submissions";
import { submissionStates } from "../../domain/contracts";
import type { WorkflowState } from "../../domain/workflow";
import { fromRpcError } from "../lib/admin-errors";
import type { AdminActor } from "../lib/admin-route";
import { auditContext } from "../lib/audit";
import { authorize } from "../lib/authz";
import type { Db } from "../lib/db";
import { AppError } from "../lib/errors";
import type { PublicCtx } from "../public/routes";
import { uploadToken, verifyUploadToken } from "./upload-token";

// `POST /submissions` and `POST /submissions/:id/uploads` (E2E-02, FE-04). The rows go in through
// `create_submission` (G49); the files go straight from the browser to the private `submissions` bucket on
// URLs signed here. One request signs at most SIGNED_PER_REQUEST photographs (two URLs each), so it stays
// inside the Workers free limit of 50 subrequests; the browser asks `signMore` for the rest.

const BUCKET = "submissions";
const SIGNED_PER_REQUEST = 10;
const UNAVAILABLE = "We could not take this just now. Please try again in a moment.";

const unavailable = () => new AppError("unavailable", undefined, UNAVAILABLE);

const mediaRowsSchema = z.array(
  z.object({ id: z.string(), index: z.number().int(), storage_path: z.string() }),
);

/** The body of `POST /submissions/:id/uploads` with the path's `id`, which the pipeline adds. */
export const signMoreSchema = submissionUploadsSchema.extend({ id: z.string().uuid() });
type SignMoreInput = z.infer<typeof signMoreSchema>;

interface SignedUpload {
  url: string;
  thumb_url: string;
}

interface UploadEntry extends Partial<SignedUpload> {
  media_id: string;
  index: number;
}

export type SubmissionReceipt = Receipt & { upload_token: string; uploads: UploadEntry[] };

/** The thumbnail PERF-08 asks for sits beside the original: `<submission id>/<media id>.thumb.jpg`. */
const thumbPath = (submissionId: string, mediaId: string): string =>
  `${submissionId}/${mediaId}.thumb.jpg`;

async function signPath(db: Db, path: string): Promise<string> {
  const { data, error } = await db.storage
    .from(BUCKET)
    .createSignedUploadUrl(path, { upsert: true });
  if (error !== null) throw unavailable();
  return data.signedUrl;
}

async function sign(
  db: Db,
  submissionId: string,
  mediaId: string,
  storagePath: string,
): Promise<SignedUpload> {
  const [url, thumbUrl] = await Promise.all([
    signPath(db, storagePath),
    signPath(db, thumbPath(submissionId, mediaId)),
  ]);
  return { url, thumb_url: thumbUrl };
}

export async function create(
  db: Db,
  input: Submission,
  ctx: PublicCtx,
): Promise<SubmissionReceipt> {
  const { data, error } = await db.rpc("create_submission", {
    p: {
      address: input.address,
      city: input.city,
      state: input.state,
      zip: input.zip,
      listing_url: input.listingUrl,
      source_url: input.sourceUrl,
      price: input.price,
      currency: input.currency,
      property_type: input.propertyType,
      beds: input.beds,
      baths: input.baths,
      interior_sq_ft: input.interiorSqFt,
      architect: input.architect,
      designer: input.designer,
      year_built: input.yearBuilt,
      year_renovated: input.yearRenovated,
      submitter_kind: input.submitterKind,
      submitter_name: input.submitterName,
      submitter_email: input.submitterEmail,
      submitter_phone: input.submitterPhone,
      brokerage: input.brokerage,
      listed_with_agent: input.listedWithAgent,
      listing_agent_name: input.listingAgentName,
      listing_agent_brokerage: input.listingAgentBrokerage,
      photography_url: input.photographyUrl,
      video_url: input.videoUrl,
      story: input.story,
      significance: input.significance,
      package: input.package,
      media_budget: input.mediaBudget,
      source_path: input.sourcePath,
      turnstile_ok: ctx.turnstileOk,
      ip_hash: ctx.ipHash,
      rights_version: currentRightsVersion,
      rights_confirmed_at: new Date().toISOString(),
      rights_ip_hash: ctx.ipHash,
      media: input.media,
    },
  });
  const row = data?.[0];
  if (error !== null || row === undefined) throw unavailable();
  const media = mediaRowsSchema.parse(row.media);
  const signed = await Promise.all(
    media
      .slice(0, SIGNED_PER_REQUEST)
      .map((entry) => sign(db, row.id, entry.id, entry.storage_path)),
  );
  return {
    id: row.id,
    receivedAt: row.received_at,
    upload_token: await uploadToken(row.id),
    uploads: media.map((entry, position) => ({
      media_id: entry.id,
      index: entry.index,
      ...signed[position],
    })),
  };
}

/** The next photographs of one submission still without their object, signed the same way (E2E-02). */
export async function signMore(
  db: Db,
  input: SignMoreInput,
): Promise<{ uploads: (SignedUpload & { media_id: string })[] }> {
  if (!(await verifyUploadToken(input.id, input.upload_token))) {
    throw new AppError(
      "forbidden",
      undefined,
      "This upload window has closed. Please send the form again.",
    );
  }
  const { data, error } = await db.rpc("submission_upload_paths", {
    p_submission_id: input.id,
    p_media_ids: input.media_ids,
  });
  if (error !== null) throw unavailable();
  return {
    uploads: await Promise.all(
      data.map(async (row) => ({
        media_id: row.media_id,
        ...(await sign(db, input.id, row.media_id, row.storage_path)),
      })),
    ),
  };
}

// The admin side (B7 step 4, screen 3). Each function authorizes before it touches the database (SEC-04).

const listRowsSchema = z.array(submissionListRowSchema);

/** A page starts after the row it names: its `received_at` exactly as stored, and its id. */
const CURSOR = /^(\d{4}-\d\d-\d\dT[\d:.]+(?:Z|[+-]\d\d:\d\d))~([0-9a-f-]{36})$/;

const cursorOf = (row: SubmissionListRow): string => `${row.received_at}~${row.id}`;

function afterCursor(cursor: string): { p_after_received_at: string; p_after_id: string } {
  const [, at, id] = CURSOR.exec(cursor) ?? [];
  if (at === undefined || id === undefined) {
    throw new AppError("validation", undefined, "This page link is no longer valid.");
  }
  return { p_after_received_at: at, p_after_id: id };
}

/** The states both the state filter and the saved view allow, or undefined when neither is set. */
function statesOf(input: ListSubmissionsInput): WorkflowState[] | undefined {
  const sets: (readonly WorkflowState[])[] = [];
  if (input.workflow_state !== undefined) sets.push([input.workflow_state]);
  if (input.view !== undefined) sets.push(savedViews[input.view].states);
  if (sets.length === 0) return undefined;
  return submissionStates.filter((state) => sets.every((set) => set.includes(state)));
}

/** `GET /api/admin/submissions`: one page, newest first, through `list_submissions` (invariant 17c, R44). */
export async function listSubmissions(
  actor: AdminActor,
  db: Db,
  input: ListSubmissionsInput,
): Promise<{ items: SubmissionListRow[]; next_cursor: string | null }> {
  authorize(actor, "submissions.list");
  const states = statesOf(input);
  const { data, error } = await db.rpc("list_submissions", {
    p_limit: input.limit + 1,
    ...(states === undefined ? {} : { p_states: states }),
    ...(input.market === undefined ? {} : { p_market: input.market }),
    ...(input.package === undefined ? {} : { p_package: input.package }),
    ...(input.search === undefined || input.search === "" ? {} : { p_search: input.search }),
    ...(input.without_property === true ? { p_without_property: true } : {}),
    ...(input.cursor === undefined ? {} : afterCursor(input.cursor)),
  });
  if (error !== null) throw fromRpcError(error);
  const rows = listRowsSchema.parse(data);
  const items = rows.slice(0, input.limit);
  const last = items.at(-1);
  return {
    items,
    next_cursor: rows.length > input.limit && last !== undefined ? cursorOf(last) : null,
  };
}

/** `POST /api/admin/submissions/start-review`: Submitted to Under Review, every id or none (`start_review`). */
export async function startReview(
  actor: AdminActor,
  db: Db,
  input: z.output<typeof startReviewInputSchema>,
): Promise<{ started: number }> {
  authorize(actor, "submissions.start_review");
  const { data, error } = await db.rpc("start_review", {
    p_submission_ids: input.ids,
    ...auditContext(actor),
  });
  if (error !== null) throw fromRpcError(error);
  return { started: data };
}
