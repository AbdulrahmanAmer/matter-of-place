import type { z } from "zod";
import type { emailPreviewAnswerSchema } from "../../domain/admin-submissions";

type Letter = z.infer<typeof emailPreviewAnswerSchema>;

/**
 * The letter a decision would send, drawn when asked (invariant 6). It is a document of its own in a sandboxed frame
 * that may run no script, so nothing in it reaches this page, whose own DOM gets no raw HTML (R44).
 */
export function EmailPreview({
  letter,
  pending,
  ready,
  error,
  onPreview,
}: {
  letter: Letter | undefined;
  pending: boolean;
  /** The dialog holds everything the letter needs. */
  ready: boolean;
  error: string | null;
  onPreview: () => void;
}) {
  return (
    <section className="admin-letter" aria-label="Letter">
      <button
        type="button"
        className="admin-button admin-button--quiet"
        disabled={pending || !ready}
        onClick={onPreview}
      >
        Preview the letter
      </button>
      {error === null ? null : <p role="alert">{error}</p>}
      {letter === undefined ? null : (
        <>
          <p className="admin-letter__subject">{letter.subject}</p>
          <iframe
            className="admin-letter__frame"
            title="Letter preview"
            sandbox=""
            srcDoc={letter.html}
          />
        </>
      )}
    </section>
  );
}
