import { z } from "zod";
import { sha256Hex } from "../lib/crypto.ts";
import type { Db } from "../lib/db.ts";
import { AppError } from "../lib/errors.ts";
import { storageUnavailable } from "../lib/media-store.ts";

// Settles the photographs browsers put straight into the private `submissions` bucket (E2E-02). Started only by
// B8's `reconcile` system job, inside the Edge Function: hashing 25 MB does not fit a Worker request. Never lists
// the bucket; reads each waiting row's own path. Loaded by Deno, so every import carries `.ts` (invariant 19).

export type ImageType = "image/jpeg" | "image/png" | "image/webp" | "image/heic";

const BUCKET = "submissions";
// The signed upload URL lives two hours; a row still empty after that will not be filled.
const UPLOAD_WINDOW_MS = 2 * 60 * 60 * 1000;
// B7 stages admin originals here for B9's render_variants (G42); they have no submission row to settle.
const STAGING = "staging/";
// GQ-07: the brands an iPhone writes, plus `heim` and `msf1` (ASSUMED until a real sample is measured).
const HEIC_BRANDS = new Set(["heic", "heix", "mif1", "heim", "msf1"]);
const DECLARED: Readonly<Record<string, ImageType>> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
};

const ascii = (bytes: Uint8Array, from: number, to: number): string =>
  String.fromCharCode(...bytes.subarray(from, to));

/** The image type the first 12 bytes announce, or null. The one copy of the table: B7's `sniffStaged` imports it. */
export function sniffImageType(bytes: Uint8Array): ImageType | null {
  const at = (index: number): number => bytes[index] ?? -1;
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "image/jpeg";
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return "image/png";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return "image/webp";
  if (ascii(bytes, 4, 8) === "ftyp" && HEIC_BRANDS.has(ascii(bytes, 8, 12))) return "image/heic";
  return null;
}

const rowsSchema = z.array(
  z.object({
    id: z.string(),
    storage_path: z.string(),
    submissions: z.object({ received_at: z.string() }),
  }),
);

const storageErrorSchema = z.object({ code: z.string() });

/** A missing object answers status 400 with the code `NoSuchKey` (measured on mop-dev in B3 step 8). */
function isNotFound(error: unknown): boolean {
  const parsed = storageErrorSchema.safeParse(error);
  return parsed.success && parsed.data.code === "NoSuchKey";
}

const databaseUnavailable = () =>
  new AppError("unavailable", undefined, "The database did not answer the upload reconcile.");

export interface ReconcileCounts {
  checked: number;
  uploaded: number;
  deleted: number;
  missing: number;
}

/**
 * Every row still without its object whose submission arrived after `since` minus the upload window: a found object
 * whose bytes match the declared type is marked uploaded, any other found object is removed, and a row whose window
 * has passed with no object counts as missing. A Storage or database error other than not-found throws, so the job
 * retries; a row already settled is skipped on the retry.
 */
export async function reconcileUploads(
  db: Db,
  since: Date,
  now = Date.now(),
): Promise<ReconcileCounts> {
  const { data, error } = await db
    .from("submission_media")
    .select("id, storage_path, submissions!inner(received_at)")
    .is("uploaded_at", null)
    .gt("submissions.received_at", new Date(since.getTime() - UPLOAD_WINDOW_MS).toISOString());
  if (error !== null) throw databaseUnavailable();
  const rows = rowsSchema.parse(data).filter((row) => !row.storage_path.startsWith(STAGING));
  const counts: ReconcileCounts = { checked: rows.length, uploaded: 0, deleted: 0, missing: 0 };
  const store = db.storage.from(BUCKET);
  for (const row of rows) {
    const download = await store.download(row.storage_path);
    if (download.error !== null) {
      if (!isNotFound(download.error)) throw storageUnavailable();
      if (now - Date.parse(row.submissions.received_at) > UPLOAD_WINDOW_MS) counts.missing += 1;
      continue;
    }
    const bytes = new Uint8Array(await download.data.arrayBuffer());
    const declared = DECLARED[row.storage_path.split(".").pop() ?? ""];
    const mime = sniffImageType(bytes);
    if (mime !== null && mime === declared) {
      const marked = await db.rpc("mark_media_uploaded", {
        p_media_id: row.id,
        p_mime: mime,
        p_sha256: await sha256Hex(bytes),
      });
      if (marked.error !== null) throw databaseUnavailable();
      counts.uploaded += 1;
    } else {
      const removed = await store.remove([row.storage_path]);
      if (removed.error !== null) throw storageUnavailable();
      counts.deleted += 1;
    }
  }
  return counts;
}
