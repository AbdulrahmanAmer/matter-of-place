import { useState } from "react";
import { Dialog } from "../ui/Dialog";
import { Field } from "../ui/Field";

// The dialog draws its children only while it is open, so the form's note starts empty on every opening.
function RejectForm({
  title,
  verb,
  hint,
  missingNote,
  pending,
  onReject,
  onCancel,
}: {
  title: string;
  verb: string;
  hint: string;
  missingNote: string;
  pending: boolean;
  onReject: (note: string) => void;
  onCancel: () => void;
}) {
  const [note, setNote] = useState("");
  const [missing, setMissing] = useState(false);

  return (
    <form
      className="admin-dialog__panel"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        const trimmed = note.trim();
        if (trimmed === "") {
          setMissing(true);
          return;
        }
        onReject(trimmed);
      }}
    >
      <div className="admin-dialog__head">
        <h2>{title}</h2>
      </div>
      <div className="admin-dialog__body">
        <Field label="Note" hint={hint} {...(missing ? { error: missingNote } : {})}>
          {(control) => (
            <textarea
              {...control}
              rows={4}
              value={note}
              onChange={(event) => {
                setNote(event.target.value);
                setMissing(false);
              }}
            />
          )}
        </Field>
      </div>
      <div className="admin-actions">
        <button type="submit" className="admin-button admin-button--danger" disabled={pending}>
          {verb}
        </button>
        <button type="button" className="admin-button admin-button--quiet" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** A reject says why: the note goes to the asset and to the event, and the database refuses a reject without one. */
export function RejectDialog({
  open,
  title,
  pending,
  onReject,
  onCancel,
  verb = "Reject",
  hint = "Say what is wrong, so the next render can fix it.",
  missingNote = "A reject needs a note.",
}: {
  open: boolean;
  title: string;
  /** The button and the missing-note message: "Reject" for a reject, "Ask for a re-render" for the proposed posts' second move. */
  verb?: string;
  hint?: string;
  missingNote?: string;
  pending: boolean;
  onReject: (note: string) => void;
  onCancel: () => void;
}) {
  return (
    <Dialog open={open} onClose={onCancel} label={title}>
      <RejectForm
        title={title}
        verb={verb}
        hint={hint}
        missingNote={missingNote}
        pending={pending}
        onReject={onReject}
        onCancel={onCancel}
      />
    </Dialog>
  );
}
