import { z } from "zod";
import { AppError } from "./errors.ts";
import { logLine } from "./log.ts";
import { readVar } from "./runtime-env.ts";

// The one Storage module (H33 (2)): plain `fetch` against the Storage REST API of the one project.
// The Worker and the job runner load it, so it reads its variables with `readVar` inside each call and
// nothing at import time.

export const buckets = {
  submissions: "submissions",
  media: "media",
  documents: "documents",
} as const;

export type Bucket = (typeof buckets)[keyof typeof buckets];

// ASSUMED batch size of one Storage delete request (E2E-01).
const DELETE_BATCH = 1000;

let baseWarned = false;

/**
 * The address of a published file. Pages and the catalog JSON use the relative `/media/<key>`;
 * `absolute` (Open Graph tags, emails, posts, feeds) prefixes `MEDIA_PUBLIC_BASE`. Never a
 * `supabase.co` address (H33 (4)).
 */
export function mediaUrl(key: string, opts?: { absolute?: boolean }): string {
  if (opts?.absolute !== true) return `/media/${key}`;
  const base = readVar("MEDIA_PUBLIC_BASE");
  if (base === undefined) {
    if (!baseWarned) {
      baseWarned = true;
      logLine("warn", "media_public_base_unset");
    }
    return `/media/${key}`;
  }
  return `${base.replace(/\/+$/, "")}/${key}`;
}

/** The one shared 503 for a Storage outage; the job system retries it. */
export function storageUnavailable(): AppError {
  return new AppError("storage_unavailable", undefined, "File storage is not answering.");
}

function storageBase(): string {
  const base = readVar("SUPABASE_URL");
  if (base === undefined) throw storageUnavailable();
  return `${base}/storage/v1`;
}

type StorageInit = RequestInit & { cf?: { cacheEverything: boolean } };

async function storageFetch(path: string, init: StorageInit): Promise<Response> {
  const url = `${storageBase()}${path}`;
  try {
    return await fetch(url, init);
  } catch {
    throw storageUnavailable();
  }
}

/** The public object, for `GET /media/<key>` to stream; the edge keeps what it fetched (H33 (4)). */
export function readPublicObject(key: string): Promise<Response> {
  return storageFetch(`/object/public/${buckets.media}/${key}`, { cf: { cacheEverything: true } });
}

// Storage answers a delete with the array of objects it removed; only its length is read.
const removedSchema = z.array(z.unknown());

async function deleteBatch(bucket: Bucket, keys: string[], serviceKey: string): Promise<number> {
  const response = await storageFetch(`/object/${bucket}`, {
    method: "DELETE",
    headers: {
      authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
      "content-type": "application/json",
    },
    body: JSON.stringify({ prefixes: keys }),
  });
  if (!response.ok) throw storageUnavailable();
  const removed = removedSchema.safeParse(await response.json().catch(() => null));
  if (!removed.success) throw storageUnavailable();
  return removed.data.length;
}

/**
 * Removes objects for B8's `takedown_media` job, never for a request. At most 1,000 keys go in one
 * request; any failure throws `storage_unavailable` so the runner retries.
 */
export async function deleteObjects(bucket: Bucket, keys: string[]): Promise<{ deleted: number }> {
  const serviceKey = readVar("SUPABASE_SERVICE_ROLE_KEY");
  if (serviceKey === undefined) throw storageUnavailable();
  let deleted = 0;
  for (let start = 0; start < keys.length; start += DELETE_BATCH) {
    deleted += await deleteBatch(bucket, keys.slice(start, start + DELETE_BATCH), serviceKey);
  }
  return { deleted };
}
