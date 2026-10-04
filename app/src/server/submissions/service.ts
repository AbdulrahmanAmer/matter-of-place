import { z } from "zod";
import {
  currentRightsVersion,
  submissionUploadsSchema,
  type Receipt,
  type Submission,
} from "../../domain/contracts";
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
