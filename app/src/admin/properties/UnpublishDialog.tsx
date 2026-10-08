import { useState } from "react";
import {
  unpublishReasons,
  type UnpublishBody,
  type UnpublishReason,
} from "../../domain/admin-properties";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { Field } from "../ui/Field";

const reasonLabels: Record<UnpublishReason, string> = {
  owner_request: "The owner asked",
  rights_takedown: "Rights takedown",
  factual_error: "Factual error",
  other: "Other",
};

/**
 * Unpublish with a reason (invariant 13). A takedown also answers 410 for the address, removes the photographs from the
 * site and stops queued posts; an archived property can still be taken down, so it offers the takedown alone.
 */
export function UnpublishDialog({
  open,
  archived,
  pending,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  archived: boolean;
  pending: boolean;
  onConfirm: (body: UnpublishBody) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState<UnpublishReason | "">("");
  const [note, setNote] = useState("");
  const [takedown, setTakedown] = useState(false);
  const noteMissing = reason === "other" && note.trim() === "";
  const asTakedown = archived || takedown;

  return (
    <ConfirmDialog
      open={open}
      title={archived ? "Take down this property" : "Unpublish this property"}
      confirmLabel={asTakedown ? "Take down" : "Unpublish"}
      danger
      pending={pending || reason === "" || noteMissing}
      onConfirm={() => {
        if (reason === "") return;
        onConfirm({
          reason,
          takedown: asTakedown,
          ...(note.trim() === "" ? {} : { note: note.trim() }),
        });
      }}
      onCancel={onCancel}
    >
      <Field label="Reason">
        {(control) => (
          <select
            {...control}
            value={reason}
            onChange={(event) => {
              const next = unpublishReasons.find((value) => value === event.target.value);
              setReason(next ?? "");
            }}
          >
            <option value="">Choose a reason</option>
            {unpublishReasons.map((value) => (
              <option key={value} value={value}>
                {reasonLabels[value]}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field
        label="Note"
        hint={reason === "other" ? "Required for Other." : "Optional. It is kept in the audit log."}
      >
        {(control) => (
          <textarea
            {...control}
            maxLength={2000}
            rows={3}
            value={note}
            onChange={(event) => {
              setNote(event.target.value);
            }}
          />
        )}
      </Field>
      {archived ? null : (
        <label className="admin-editor__switch">
          <input
            type="checkbox"
            checked={takedown}
            onChange={(event) => {
              setTakedown(event.target.checked);
            }}
          />
          Takedown
        </label>
      )}
      {asTakedown ? (
        <p>
          The address will answer that the page is gone, for good. The photographs leave the site
          and queued posts stop. Posts already live are withdrawn by hand. Aim to finish within 24
          hours.
        </p>
      ) : (
        <p>
          The page stops showing. You can return the property to draft and publish it again later.
        </p>
      )}
    </ConfirmDialog>
  );
}
