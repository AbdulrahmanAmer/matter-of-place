import { useId, useState, type ChangeEvent } from "react";
import { uploadLimits } from "../../domain/contracts";
import { sendAccountPhotos, UnsupportedPhotoError } from "../../lib/account-photos";

const count = (n: number, noun: string): string => `${String(n)} ${noun}${n === 1 ? "" : "s"}`;

/** What to tell the client when a send stopped: the file kind, or a plain "try again". */
function problem(error: unknown): string {
  if (error instanceof UnsupportedPhotoError) return error.message;
  return "We could not take these just now. Please try again.";
}

/**
 * Add photographs to an open request (W6 item 8, phase 2). The files go straight from the browser to storage; the line
 * under the field says how many have gone and, if some did not, to choose them again.
 */
export function AccountPhotos({
  submissionId,
  photos,
  onSent,
}: {
  submissionId: string;
  /** How many photographs the request already holds. */
  photos: number;
  /** Called once a send has finished, so the page can read the new count. */
  onSent: () => void;
}) {
  const id = useId();
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  const choose = (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const files = Array.from(input.files ?? []);
    if (files.length === 0) return;
    setBusy(true);
    setStatus(`Sending ${count(files.length, "photograph")}.`);
    void sendAccountPhotos(submissionId, files, ({ done, total }) => {
      setStatus(`Sent ${String(done)} of ${String(total)}.`);
    })
      .then(({ sent, failed }) => {
        setStatus(
          failed === 0
            ? `${count(sent, "photograph")} sent. We will see ${sent === 1 ? "it" : "them"} shortly.`
            : `${String(sent)} sent. ${count(failed, "photograph")} did not go through: choose ${failed === 1 ? "it" : "them"} again.`,
        );
        onSent();
      })
      .catch((error: unknown) => {
        setStatus(problem(error));
      })
      .finally(() => {
        setBusy(false);
        // The same file can be chosen again.
        input.value = "";
      });
  };

  return (
    <div className="account-photos">
      <p>
        {photos === 0
          ? "No photographs on this request yet."
          : `${count(photos, "photograph")} on this request.`}
      </p>
      <label htmlFor={id}>Add photographs</label>
      <input
        id={id}
        type="file"
        multiple
        accept={uploadLimits.types.join(",")}
        disabled={busy}
        onChange={choose}
      />
      <p role="status" aria-live="polite">
        {status}
      </p>
    </div>
  );
}
