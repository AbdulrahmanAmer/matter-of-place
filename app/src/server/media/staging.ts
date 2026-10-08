import { z } from "zod";
import type { MediaScope, StagedUpload, UploadType } from "../../domain/admin-media.ts";
import { toHex } from "../lib/crypto.ts";
import type { Db } from "../lib/db.ts";
import { AppError } from "../lib/errors.ts";
import { sniffImageType } from "../submissions/reconcile.ts";

// The admin's uploads (B7 step 8, G25, ruling H33). The browser puts each file straight into the private bucket
// `submissions` under `staging/`, and B9's render_variants alone writes its variants to the public bucket `media`.
// This file never touches `media`. It is the adapter of the one Storage read Storage's client cannot make: the
// first 64 bytes of an object (R32).

const BUCKET = "submissions";
const SNIFF_BYTES = 64;
const SNIFF_URL_SECONDS = 60;
const SNIFF_TIMEOUT_MS = 10_000;

const EXTENSIONS: Readonly<Record<UploadType, string>> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
};

const storageErrorSchema = z.object({ code: z.string() });

const storageUnavailable = () =>
  new AppError("storage_unavailable", undefined, "File storage is not answering.");

const invalidImage = () =>
  new AppError(
    "invalid_image",
    undefined,
    "This file is not a JPEG, PNG, WebP or HEIC photograph.",
  );

/** A missing object answers status 400 with the code `NoSuchKey` (P-820). */
const isNotFound = (error: unknown) => {
  const parsed = storageErrorSchema.safeParse(error);
  return parsed.success && parsed.data.code === "NoSuchKey";
};

/** The type `createStagingUpload` named in the object's extension. */
const DECLARED: Readonly<Record<string, UploadType>> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
};

/**
 * The object name of an upload and its signed upload URL. A property's first upload gets the id its
 * `property_media` row will take (G42); a replace gets a fresh 8 hex suffix, so it never overwrites a staged file and
 * its render gets a new job key (G54); a story, market or region image gets a fresh name under its slug (G51).
 */
export async function createStagingUpload(
  db: Db,
  input: { scope: MediaScope; target: string; mediaId?: string },
  mime: UploadType,
): Promise<StagedUpload> {
  const extension = EXTENSIONS[mime];
  const mediaId = input.scope === "property" ? (input.mediaId ?? crypto.randomUUID()) : undefined;
  const path =
    mediaId === undefined
      ? `staging/${input.scope}/${input.target}/${crypto.randomUUID()}.${extension}`
      : input.mediaId === undefined
        ? `staging/${input.target}/${mediaId}.${extension}`
        : `staging/${input.target}/${mediaId}.${toHex(crypto.getRandomValues(new Uint8Array(4)))}.${extension}`;
  const { data, error } = await db.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error !== null) throw storageUnavailable();
  return { ...(mediaId === undefined ? {} : { media_id: mediaId }), path, url: data.signedUrl };
}

/** Up to `count` bytes of a body, then the rest is cancelled: Storage may answer 200 with the whole file. */
async function firstBytes(
  body: ReadableStream<Uint8Array> | null,
  count: number,
): Promise<Uint8Array> {
  const bytes = new Uint8Array(count);
  if (body === null) return bytes.subarray(0, 0);
  const reader = body.getReader();
  let filled = 0;
  while (filled < count) {
    const { done, value } = await reader.read();
    if (done) break;
    const part = value.subarray(0, count - filled);
    bytes.set(part, filled);
    filled += part.length;
  }
  await reader.cancel();
  return bytes.subarray(0, filled);
}

/** Removes a staged object; a Storage error is a 503 the editor may retry. */
export async function removeStaged(db: Db, path: string): Promise<void> {
  const { error } = await db.storage.from(BUCKET).remove([path]);
  if (error !== null) throw storageUnavailable();
}

/**
 * The staged file is the photograph its name says: its first 64 bytes, read through a 60 second signed URL, carry
 * the signature of the type in its extension (B3's `sniffImageType`). Anything else is removed and refused.
 */
export async function sniffStaged(db: Db, path: string): Promise<void> {
  const signed = await db.storage.from(BUCKET).createSignedUrl(path, SNIFF_URL_SECONDS);
  if (signed.error !== null) {
    if (isNotFound(signed.error)) throw invalidImage();
    throw storageUnavailable();
  }
  let response: Response;
  try {
    response = await fetch(signed.data.signedUrl, {
      headers: { range: `bytes=0-${String(SNIFF_BYTES - 1)}` },
      signal: AbortSignal.timeout(SNIFF_TIMEOUT_MS),
    });
  } catch {
    throw storageUnavailable();
  }
  if (response.status !== 200 && response.status !== 206) throw storageUnavailable();
  const found = sniffImageType(await firstBytes(response.body, SNIFF_BYTES));
  if (found === null || found !== DECLARED[path.slice(path.lastIndexOf(".") + 1)]) {
    await removeStaged(db, path);
    throw invalidImage();
  }
}
