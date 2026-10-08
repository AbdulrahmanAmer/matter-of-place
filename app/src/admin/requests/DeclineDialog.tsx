import { useState } from "react";
import type { DecisionAnswer } from "../../domain/admin-submissions";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { Field } from "../ui/Field";
import { EmailPreview } from "./EmailPreview";
import { useDecision, useDeclineReasons, useEmailPreview } from "./requests-queries";

/** Decline with a reason from the list and an optional note; both go into the letter the preview shows. */
export function DeclineDialog({
  id,
  open,
  onClose,
  onDecided,
}: {
  id: string;
  open: boolean;
  onClose: () => void;
  onDecided: (answer: DecisionAnswer) => void;
}) {
  const reasons = useDeclineReasons(open);
  const preview = useEmailPreview(id);
  const decline = useDecision(id, "decline");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const body = { decline_reason_id: reason, ...(note.trim() === "" ? {} : { note }) };

  return (
    <ConfirmDialog
      open={open}
      title="Decline this request"
      confirmLabel="Decline"
      danger
      pending={decline.isPending || reason === ""}
      onConfirm={() => {
        decline.mutate(body, { onSuccess: onDecided });
      }}
      onCancel={onClose}
    >
      <Field label="Reason">
        {(control) => (
          <select
            {...control}
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
              preview.reset();
            }}
          >
            <option value="">Choose a reason</option>
            {(reasons.data?.items ?? []).map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="Note to the sender" hint="Optional. It is added to the letter.">
        {(control) => (
          <textarea
            {...control}
            maxLength={2000}
            rows={3}
            value={note}
            onChange={(event) => {
              setNote(event.target.value);
              preview.reset();
            }}
          />
        )}
      </Field>
      <EmailPreview
        letter={preview.data}
        pending={preview.isPending}
        ready={reason !== ""}
        error={preview.error?.message ?? null}
        onPreview={() => {
          preview.mutate({ template: "declined", ...body });
        }}
      />
      {decline.error === null ? null : <p role="alert">{decline.error.message}</p>}
    </ConfirmDialog>
  );
}
