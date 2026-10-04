import type { PreparedImage } from "../../lib/image-prep";
import type { UploadProgress } from "../types";

// Sends the photographs of a received submission to their signed Storage URLs (FE-04): files go by their index in
// the posted `media` array, never by name, at most three PUTs at a time, each retried on its own URL, which stays
// valid for two hours. A failure never undoes the submission: the queue reports it and can send it again.

export interface UploadEntry {
  media_id: string;
  index: number;
  url?: string | undefined;
  thumb_url?: string | undefined;
}

export interface SignedUpload {
  media_id: string;
  url: string;
  thumb_url: string;
}

interface QueueOptions {
  entries: UploadEntry[];
  /** The prepared photographs in the order of the posted `media` array. */
  files: PreparedImage[];
  /** `POST /submissions/:id/uploads` for up to ten entries the receipt left unsigned. */
  fetchMore: (mediaIds: string[]) => Promise<SignedUpload[]>;
  onProgress?: ((progress: UploadProgress) => void) | undefined;
}

const CONCURRENCY = 3;
const SIGN_BATCH = 10;
const BACKOFF_MS = [1000, 3000, 9000];

const pause = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

function putOnce(url: string, body: Blob, type: string): Promise<boolean> {
  return new Promise((resolve) => {
    const request = new XMLHttpRequest();
    request.open("PUT", url);
    request.setRequestHeader("content-type", type);
    request.onload = () => {
      resolve(request.status >= 200 && request.status < 300);
    };
    request.onerror = () => {
      resolve(false);
    };
    request.send(body);
  });
}

/** One PUT, retried after 1, 3 and 9 seconds. */
async function put(url: string, body: Blob, type: string): Promise<boolean> {
  if (await putOnce(url, body, type)) return true;
  for (const wait of BACKOFF_MS) {
    await pause(wait);
    if (await putOnce(url, body, type)) return true;
  }
  return false;
}

/** Holds the page while photographs are still going out. */
function guardUnload(): () => void {
  if (typeof window === "undefined") return () => undefined;
  const warn = (event: BeforeUnloadEvent) => {
    event.preventDefault();
  };
  window.addEventListener("beforeunload", warn);
  return () => {
    window.removeEventListener("beforeunload", warn);
  };
}

export async function runUploadQueue(options: QueueOptions): Promise<{ failed: number[] }> {
  const { entries, files, fetchMore, onProgress } = options;
  const known = new Map<string, SignedUpload>();
  for (const { media_id, url, thumb_url } of entries) {
    if (url !== undefined && thumb_url !== undefined)
      known.set(media_id, { media_id, url, thumb_url });
  }
  const signing = new Map<string, Promise<SignedUpload | undefined>>();
  const done = new Set<number>();
  let failed = new Set<number>();

  /** The entry's URLs: from the receipt, else from one `fetchMore` call for it and the next unsigned entries. */
  function targets(entry: UploadEntry): Promise<SignedUpload | undefined> {
    const ready = known.get(entry.media_id) ?? signing.get(entry.media_id);
    if (ready !== undefined) return Promise.resolve(ready);
    const batch = entries
      .slice(entries.indexOf(entry))
      .filter(({ media_id }) => !known.has(media_id) && !signing.has(media_id))
      .slice(0, SIGN_BATCH);
    // A refused call leaves its entries unsigned: they fail here and are asked for again on retry.
    const answer = fetchMore(batch.map(({ media_id }) => media_id)).catch((): SignedUpload[] => []);
    for (const { media_id } of batch) {
      const signed = answer.then((uploads) => {
        signing.delete(media_id);
        const found = uploads.find((upload) => upload.media_id === media_id);
        if (found !== undefined) known.set(media_id, found);
        return found;
      });
      signing.set(media_id, signed);
    }
    return signing.get(entry.media_id) ?? Promise.resolve(undefined);
  }

  async function send(entry: UploadEntry): Promise<boolean> {
    const file = files[entry.index];
    if (file === undefined) return false;
    const signed = await targets(entry);
    if (signed === undefined) return false;
    if (!(await put(signed.url, file.original, file.type))) return false;
    return file.thumb === null || put(signed.thumb_url, file.thumb, "image/jpeg");
  }

  const report = () => {
    onProgress?.({ done: done.size, total: entries.length, failed: failed.size, retry });
  };

  async function run(batch: UploadEntry[]): Promise<void> {
    const release = guardUnload();
    const waiting = [...batch];
    const worker = async () => {
      for (let entry = waiting.shift(); entry !== undefined; entry = waiting.shift()) {
        if (await send(entry)) done.add(entry.index);
        else failed.add(entry.index);
        report();
      }
    };
    try {
      await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    } finally {
      release();
    }
  }

  async function retry(): Promise<void> {
    const again = entries.filter((entry) => failed.has(entry.index));
    failed = new Set();
    report();
    await run(again);
  }

  report();
  await run(entries);
  return { failed: [...failed] };
}
