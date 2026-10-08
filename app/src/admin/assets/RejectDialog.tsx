import { useState } from "react";
import { Dialog } from "../ui/Dialog";
import { Field } from "../ui/Field";

// The dialog draws its children only while it is open, so the form's note starts empty on every opening.
function RejectForm({
  title,
  pending,
  onReject,
  onCancel,
}: {
  title: string;
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
        <Field
          label="Note"
          hint="Say what is wrong, so the next render can fix it."
          {...(missing ? { error: "A reject needs a note." } : {})}
        >
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
          Reject
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
}: {
  open: boolean;
  title: string;
  pending: boolean;
  onReject: (note: string) => void;
  onCancel: () => void;
}) {
  return (
    <Dialog open={open} onClose={onCancel} label={title}>
      <RejectForm title={title} pending={pending} onReject={onReject} onCancel={onCancel} />
    </Dialog>
  );
}
