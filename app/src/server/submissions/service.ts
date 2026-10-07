import { z } from "zod";
import {
  currentRightsVersion,
  submissionUploadsSchema,
  type Receipt,
  type Submission,
} from "../../domain/contracts";
import { siteConfig } from "../../config/site";
import {
  savedViews,
  submissionListRowSchema,
  submissionNoteSchema,
  type DecisionAnswer,
  type DeclineReason,
  type ListSubmissionsInput,
  type SubmissionDetail,
  type SubmissionListRow,
  type SubmissionNote,
  type TimelineEntry,
  type declineInputSchema,
  type emailPreviewSchema,
  type noteInputSchema,
  type originalInputSchema,
  type requestAssetsInputSchema,
  type startReviewInputSchema,
  type submissionIdInputSchema,
} from "../../domain/admin-submissions";
import { submissionStates } from "../../domain/contracts";
import type { WorkflowState } from "../../domain/workflow";
import { fanoutEvent } from "../automation/fanout";
import { loadSiteContext } from "../email/context";
import type { RenderedEmail } from "../email/render";
import { previewTemplate } from "../email/preview";
import { resolveVariables } from "../email/variables";
import type { JsonObject } from "../jobs/types";
import { fromRpcError } from "../lib/admin-errors";
import type { AdminActor } from "../lib/admin-route";
import { auditContext } from "../lib/audit";
import { authorize } from "../lib/authz";
import type { Db } from "../lib/db";
import { AppError } from "../lib/errors";
import { logLine } from "../lib/log";
import { entityTimeline } from "../lib/timeline";
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

const THUMB_SECONDS = 3600;
const ORIGINAL_SECONDS = 600;

const detailColumns =
  "id, received_at, workflow_state, accepted_at, decline_note, duplicate_of, address, city, state, zip, property_type, price, currency, beds, baths, interior_sq_ft, year_built, year_renovated, architect, designer, package, media_budget, contact_id, submitter_kind, submitter_name, submitter_email, submitter_phone, brokerage, listed_with_agent, listing_agent_name, listing_agent_brokerage, listing_url, source_url, photography_url, video_url, story, significance, notes" as const;

/** The id of the newest payment of a request that is not void, or null: the target of screen 4's invoice link. */
export async function newestPaymentId(db: Db, submissionId: string): Promise<string | null> {
  const { data, error } = await db
    .from("payments")
    .select("id")
    .eq("submission_id", submissionId)
    .in("status", ["due", "paid", "waived", "refunded"])
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1);
  if (error !== null) throw fromRpcError(error);
  return data[0]?.id ?? null;
}

/** One hour of signed thumbnails in one call; a path with no object, or a failed call, has none (PERF-08). */
async function signThumbnails(
  db: Db,
  submissionId: string,
  mediaIds: readonly string[],
): Promise<Map<string, string>> {
  const signed = new Map<string, string>();
  if (mediaIds.length === 0) return signed;
  const { data, error } = await db.storage.from(BUCKET).createSignedUrls(
    mediaIds.map((mediaId) => thumbPath(submissionId, mediaId)),
    THUMB_SECONDS,
  );
  if (error !== null) {
    logLine("warn", "thumbnail_sign_failed", {
      submission_id: submissionId,
      photos: mediaIds.length,
    });
    return signed;
  }
  for (const entry of data) {
    if (entry.path !== null && entry.signedUrl !== null) {
      signed.set(entry.path, entry.signedUrl);
    }
  }
  return signed;
}

/** `GET /api/admin/submissions/:id`: the request as submitted, its photographs with thumbnails, notes and links onward. */
export async function getSubmission(
  actor: AdminActor,
  db: Db,
  input: z.output<typeof submissionIdInputSchema>,
): Promise<SubmissionDetail> {
  authorize(actor, "submissions.get");
  const [row, media, property, paymentId] = await Promise.all([
    db.from("submissions").select(detailColumns).eq("id", input.id).maybeSingle(),
    db
      .from("submission_media")
      .select("id, name, mime, bytes, sort_order, uploaded_at")
      .eq("submission_id", input.id)
      .order("sort_order")
      .order("id"),
    db.from("properties").select("id").eq("submission_id", input.id).maybeSingle(),
    newestPaymentId(db, input.id),
  ]);
  if (row.error !== null) throw fromRpcError(row.error);
  if (media.error !== null) throw fromRpcError(media.error);
  if (property.error !== null) throw fromRpcError(property.error);
  if (row.data === null) {
    throw new AppError("not_found", undefined, "This request could not be found.");
  }
  const thumbs = await signThumbnails(
    db,
    input.id,
    media.data.map((photo) => photo.id),
  );
  const { notes, ...fields } = row.data;
  return {
    ...fields,
    notes: z.array(submissionNoteSchema).parse(notes),
    property_id: property.data?.id ?? null,
    payment_id: paymentId,
    media: media.data.map((photo) => ({
      ...photo,
      thumb_url: thumbs.get(thumbPath(input.id, photo.id)) ?? null,
    })),
  };
}

/** `GET /api/admin/submissions/:id/media/:mediaId/original`: the one original, signed for ten minutes (PERF-08). */
export async function originalUrl(
  actor: AdminActor,
  db: Db,
  input: z.output<typeof originalInputSchema>,
): Promise<{ url: string }> {
  authorize(actor, "submissions.get");
  const { data, error } = await db
    .from("submission_media")
    .select("storage_path")
    .eq("id", input.mediaId)
    .eq("submission_id", input.id)
    .maybeSingle();
  if (error !== null) throw fromRpcError(error);
  if (data === null) {
    throw new AppError("not_found", undefined, "This photograph is not on this request.");
  }
  const signed = await db.storage.from(BUCKET).createSignedUrl(data.storage_path, ORIGINAL_SECONDS);
  if (signed.error !== null) {
    throw new AppError(
      "storage_unavailable",
      undefined,
      "The photograph could not be opened just now. Please try again in a moment.",
    );
  }
  return { url: signed.data.signedUrl };
}

/** `POST /api/admin/submissions/:id/note`: one internal note, kept on the request (`add_submission_note`). */
export async function addNote(
  actor: AdminActor,
  db: Db,
  input: z.output<typeof noteInputSchema>,
): Promise<SubmissionNote> {
  authorize(actor, "submissions.note");
  const { data, error } = await db.rpc("add_submission_note", {
    p_submission_id: input.id,
    p_text: input.text,
    ...auditContext(actor),
  });
  if (error !== null) throw fromRpcError(error);
  return submissionNoteSchema.parse(data);
}

/** `GET /api/admin/submissions/:id/timeline`: audit rows and job events of the request, newest first. */
export async function timeline(
  actor: AdminActor,
  db: Db,
  input: z.output<typeof submissionIdInputSchema>,
): Promise<{ items: TimelineEntry[] }> {
  authorize(actor, "submissions.timeline");
  return { items: await entityTimeline(db, "submission", input.id) };
}

/**
 * After the decision has committed: plan its event's jobs now, best effort (the runner's sweep is the safety net, B8b
 * invariant 4), then read the jobs of the event once (invariant 1). A failure here never undoes the decision, so it is
 * logged and the answer carries the jobs found, none at worst.
 */
async function afterDecision(db: Db, eventId: string): Promise<DecisionAnswer> {
  try {
    await fanoutEvent(db, eventId);
  } catch (failure) {
    logLine("warn", "fanout_failed", {
      eventId,
      code: failure instanceof AppError ? failure.code : "server",
    });
  }
  const { data, error } = await db
    .from("jobs")
    .select("id, type, status")
    .eq("event_id", eventId)
    .order("id");
  if (error !== null) {
    logLine("warn", "decision_jobs_unread", { eventId });
    return { event_id: eventId, jobs: [] };
  }
  return { event_id: eventId, jobs: data };
}

/** `POST /api/admin/submissions/:id/decline`: Under Review to Declined; its recipe sends the decline letter. */
export async function decline(
  actor: AdminActor,
  db: Db,
  input: z.output<typeof declineInputSchema>,
): Promise<DecisionAnswer> {
  authorize(actor, "submissions.decline");
  const { data, error } = await db.rpc("decline_submission", {
    p_submission_id: input.id,
    p_reason_id: input.decline_reason_id,
    p_note: input.note ?? "",
    ...auditContext(actor),
  });
  if (error !== null) throw fromRpcError(error);
  return afterDecision(db, data);
}

/** `POST /api/admin/submissions/:id/accept`: Under Review to Accepted; its recipe sends the acceptance letter. */
export async function accept(
  actor: AdminActor,
  db: Db,
  input: z.output<typeof submissionIdInputSchema>,
): Promise<DecisionAnswer> {
  authorize(actor, "submissions.accept");
  const { data, error } = await db.rpc("accept_submission", {
    p_submission_id: input.id,
    ...auditContext(actor),
  });
  if (error !== null) throw fromRpcError(error);
  return afterDecision(db, data);
}

/** `POST /api/admin/submissions/:id/request-assets`: to Awaiting Assets; the letter says what is needed. */
export async function requestAssets(
  actor: AdminActor,
  db: Db,
  input: z.output<typeof requestAssetsInputSchema>,
): Promise<DecisionAnswer> {
  authorize(actor, "submissions.request_assets");
  const { data, error } = await db.rpc("request_assets", {
    p_submission_id: input.id,
    p_note: input.note,
    ...auditContext(actor),
  });
  if (error !== null) throw fromRpcError(error);
  return afterDecision(db, data);
}

/** `POST /api/admin/submissions/:id/assets-received`: back to Accepted, or to Under Review if never accepted. */
export async function assetsReceived(
  actor: AdminActor,
  db: Db,
  input: z.output<typeof submissionIdInputSchema>,
): Promise<{ workflow_state: WorkflowState }> {
  authorize(actor, "submissions.assets_received");
  const { data, error } = await db.rpc("assets_received", {
    p_submission_id: input.id,
    ...auditContext(actor),
  });
  if (error !== null) throw fromRpcError(error);
  return { workflow_state: data };
}

/**
 * `POST /api/admin/submissions/:id/email-preview`: the letter a decision would send (invariant 6). The variables are
 * built from the keys the decision event gives `send_email`, by the same resolver, so the preview is the send.
 */
export async function emailPreview(
  actor: AdminActor,
  db: Db,
  input: z.output<typeof emailPreviewSchema>,
): Promise<Omit<RenderedEmail, "text">> {
  authorize(actor, "submissions.email_preview");
  const data: JsonObject = {
    submission_id: input.id,
    ...(input.decline_reason_id === undefined
      ? {}
      : { decline_reason_id: input.decline_reason_id }),
    ...(input.note === undefined || input.note === "" ? {} : { note: input.note }),
  };
  const site = await loadSiteContext(db, siteConfig.url);
  const variables = await resolveVariables(db, input.template, data, undefined, site);
  const { subject, preheader, html } = await previewTemplate(db, {
    key: input.template,
    variables,
  });
  return { subject, preheader, html };
}

/** `GET /api/admin/submissions/decline-reasons`: the reasons the decline dialog offers, in their set order. */
export async function listDeclineReasons(
  actor: AdminActor,
  db: Db,
): Promise<{ items: DeclineReason[] }> {
  authorize(actor, "submissions.decline_reasons");
  const { data, error } = await db
    .from("decline_reasons")
    .select("id, code, label")
    .eq("enabled", true)
    .order("sort")
    .order("label");
  if (error !== null) throw fromRpcError(error);
  return { items: data };
}
