import { useEffect, useState } from "react";
import { AdminApiError } from "../ui/admin-fetch";
import { Field } from "../ui/Field";

const AUTOSAVE_MS = 1500;

type Status = "idle" | "saving" | "stale" | "reloaded" | "failed";

/**
 * The internal notes on a person (screen 27), saved whole 1.5 seconds after the last keystroke, one save at a time,
 * each with the version the previous save returned. When someone else saved first (409 `stale`), autosave stops and
 * the text stays; after Reload the editor replaces their notes only by pressing Save.
 */
export function PersonNotes({
  notes,
  updatedAt,
  canEdit,
  onSave,
  onReload,
}: {
  notes: string | null;
  updatedAt: string;
  canEdit: boolean;
  /** Resolves the new `updated_at`; rejects with the `AdminApiError` of a refused save. */
  onSave: (notes: string, expectedUpdatedAt: string) => Promise<string>;
  onReload: () => Promise<{ notes: string | null; updatedAt: string }>;
}) {
  const [text, setText] = useState(notes ?? "");
  const [saved, setSaved] = useState({ text: notes ?? "", version: updatedAt });
  const [status, setStatus] = useState<Status>("idle");
  const [failure, setFailure] = useState<string | null>(null);

  const save = (next: string) => {
    setStatus("saving");
    onSave(next, saved.version).then(
      (version) => {
        setSaved({ text: next, version });
        setFailure(null);
        setStatus("idle");
      },
      (error: unknown) => {
        if (error instanceof AdminApiError && error.code === "stale") {
          setStatus("stale");
          return;
        }
        setFailure(error instanceof Error ? error.message : "The notes could not be saved.");
        setStatus("failed");
      },
    );
  };

  useEffect(() => {
    if (!canEdit || status !== "idle" || text === saved.text) return;
    const timer = setTimeout(() => {
      save(text);
    }, AUTOSAVE_MS);
    return () => {
      clearTimeout(timer);
    };
  });

  const reload = () => {
    onReload().then(
      (latest) => {
        setSaved({ text: latest.notes ?? "", version: latest.updatedAt });
        setStatus((latest.notes ?? "") === text ? "idle" : "reloaded");
      },
      (error: unknown) => {
        setFailure(error instanceof Error ? error.message : "The notes could not be reloaded.");
      },
    );
  };

  if (!canEdit) {
    return (
      <section className="admin-notes" aria-label="Internal notes">
        <h2>Internal notes</h2>
        <p className="admin-prose">{notes ?? "No notes yet."}</p>
      </section>
    );
  }

  return (
    <section className="admin-notes" aria-label="Internal notes">
      <h2>Internal notes</h2>
      {status === "stale" ? (
        <p role="alert">
          Someone else saved these notes. Your text is still here.{" "}
          <button type="button" className="admin-button admin-button--quiet" onClick={reload}>
            Reload
          </button>
        </p>
      ) : null}
      {status === "reloaded" ? (
        <p role="status">Reloaded. Save replaces the notes someone else saved with your text.</p>
      ) : null}
      <Field label="Notes" {...(failure === null ? {} : { error: failure })}>
        {(control) => (
          <textarea
            {...control}
            rows={6}
            maxLength={5000}
            value={text}
            onChange={(event) => {
              setText(event.target.value);
            }}
          />
        )}
      </Field>
      <button
        type="button"
        className="admin-button admin-button--quiet"
        disabled={status === "saving" || status === "stale" || text === saved.text}
        onClick={() => {
          save(text);
        }}
      >
        {status === "saving" ? "Saving" : "Save"}
      </button>
    </section>
  );
}
