import { useState } from "react";
import type { Assignee } from "../../domain/admin-inquiries";
import { Dialog } from "../ui/Dialog";
import { Field } from "../ui/Field";

/** Picks the editor who takes the inquiry; the list holds the people who may act on inquiries. */
export function AssignDialog({
  open,
  assignees,
  current,
  pending,
  onAssign,
  onCancel,
}: {
  open: boolean;
  assignees: readonly Assignee[];
  current: string | null;
  pending: boolean;
  onAssign: (assignee: string) => void;
  onCancel: () => void;
}) {
  const [chosen, setChosen] = useState(current ?? "");
  return (
    <Dialog open={open} onClose={onCancel} label="Assign this inquiry">
      <div className="admin-dialog__panel">
        <div className="admin-dialog__head">
          <h2>Assign this inquiry</h2>
        </div>
        <div className="admin-dialog__body">
          <Field label="Editor">
            {(control) => (
              <select
                {...control}
                value={chosen}
                onChange={(event) => {
                  setChosen(event.target.value);
                }}
              >
                <option value="">Choose an editor</option>
                {assignees.map((assignee) => (
                  <option key={assignee.id} value={assignee.id}>
                    {assignee.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
        <div className="admin-actions">
          <button
            type="button"
            className="admin-button"
            disabled={pending || chosen === ""}
            onClick={() => {
              onAssign(chosen);
            }}
          >
            Assign
          </button>
          <button type="button" className="admin-button admin-button--quiet" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </Dialog>
  );
}
