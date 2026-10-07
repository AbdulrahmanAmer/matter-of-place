import { useState } from "react";
import type { SubmissionNote } from "../../domain/admin-submissions";
import { ActorBadge } from "../ui/ActorBadge";
import { Field } from "../ui/Field";
import { LocalTime } from "../ui/LocalTime";
import { actorOf } from "./request-history";

/** The internal notes of a request, newest first, and the form to add one for those who may (`submissions.note`). */
export function NotesPanel({
  notes,
  marketSlug,
  canNote,
  pending,
  error,
  onAdd,
}: {
  notes: readonly SubmissionNote[];
  marketSlug: string;
  canNote: boolean;
  pending: boolean;
  error: string | null;
  /** Resolves true when the note was kept, so the form can clear. */
  onAdd: (text: string) => Promise<boolean>;
}) {
  const [text, setText] = useState("");
  const newestFirst = [...notes].reverse();
  return (
    <section className="admin-notes" aria-label="Internal notes">
      <h2>Internal notes</h2>
      {newestFirst.length === 0 ? (
        <p className="admin-notes__none">No notes yet.</p>
      ) : (
        <ul>
          {newestFirst.map((note) => {
            const actor = actorOf(note.actor_id, note.actor_kind);
            return (
              <li key={note.id}>
                <p className="admin-prose">{note.text}</p>
                <p className="admin-notes__meta">
                  <ActorBadge name={actor.name} kind={actor.kind} />
                  <LocalTime value={note.at} marketSlug={marketSlug} />
                </p>
              </li>
            );
          })}
        </ul>
      )}
      {canNote ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void onAdd(text).then((kept) => {
              if (kept) setText("");
            });
          }}
        >
          <Field label="Add a note" {...(error === null ? {} : { error })}>
            {(control) => (
              <textarea
                {...control}
                rows={3}
                maxLength={2000}
                value={text}
                onChange={(event) => {
                  setText(event.target.value);
                }}
              />
            )}
          </Field>
          <button
            type="submit"
            className="admin-button admin-button--quiet"
            disabled={pending || text.trim() === ""}
          >
            Add note
          </button>
        </form>
      ) : null}
    </section>
  );
}
