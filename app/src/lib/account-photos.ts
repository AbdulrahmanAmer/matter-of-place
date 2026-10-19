import { uploadLimits } from "../domain/contracts";
import { runUploadQueue } from "../services/http/upload-queue";
import { addAccountPhotosFn } from "./account.functions";
import { prepareImage, type PreparedImage } from "./image-prep";

// W6 item 8 (phase 2): photographs from the client room to an open request. The Worker declares and signs ten at a time
// (`account_add_photos`), the browser puts each file straight into Storage through the upload queue the submit form uses,
// and the `reconcile` job settles them. A failure never undoes the photographs already sent.

/** The most the Worker declares in one call; the same as the submit form signs per request. */
const BATCH = 10;

interface PhotoProgress {
  done: number;
  total: number;
}

type PhotoType = (typeof uploadLimits.types)[number];

const isPhotoType = (type: string): type is PhotoType =>
  uploadLimits.types.some((accepted) => accepted === type);

/** Thrown for a file that is not a photograph the form accepts, before anything is sent. */
export class UnsupportedPhotoError extends Error {
  constructor(name: string) {
    super(`${name} is not a JPEG, PNG, WebP or HEIC photograph.`);
  }
}

/**
 * Sends `files` to the request, one batch at a time, and says how many arrived and how many did not. A batch the Worker
 * refuses (the request is no longer open, a limit) throws and stops there, with the earlier batches already sent.
 */
export async function sendAccountPhotos(
  submissionId: string,
  files: readonly File[],
  onProgress: (progress: PhotoProgress) => void,
): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  onProgress({ done: 0, total: files.length });
  for (let from = 0; from < files.length; from += BATCH) {
    const batch = files.slice(from, from + BATCH);
    // One at a time: decoding forty photographs at once would exhaust a phone's memory (FE-04).
    const prepared: PreparedImage[] = [];
    const media: { name: string; size: number; type: PhotoType }[] = [];
    for (const file of batch) {
      const image = await prepareImage(file);
      if (!isPhotoType(image.type)) throw new UnsupportedPhotoError(file.name);
      prepared.push(image);
      media.push({ name: file.name, size: image.original.size, type: image.type });
    }
    const answer = await addAccountPhotosFn({ data: { submission_id: submissionId, media } });
    const result = await runUploadQueue({
      entries: answer.uploads,
      files: prepared,
      // Every entry of a batch is signed in the answer, so the queue never needs to ask for more.
      fetchMore: () => Promise.resolve([]),
    });
    failed += result.failed.length;
    sent += batch.length - result.failed.length;
    onProgress({ done: sent + failed, total: files.length });
  }
  return { sent, failed };
}
