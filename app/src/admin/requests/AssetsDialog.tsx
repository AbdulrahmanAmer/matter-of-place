import { useState } from "react";
import type { DecisionAnswer } from "../../domain/admin-submissions";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { Field } from "../ui/Field";
import { EmailPreview } from "./EmailPreview";
import { useDecision, useEmailPreview } from "./requests-queries";

const NOTE_MIN = 3;

/** Ask the sender for more material; what is needed is required and goes into the letter the preview shows. */
export function AssetsDialog({
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
  const preview = useEmailPreview(id);
  const ask = useDecision(id, "request-assets");
  const [note, setNote] = useState("");
  const ready = note.trim().length >= NOTE_MIN;
  return (
    <ConfirmDialog
      open={open}
      title="Request material"
      confirmLabel="Send the request"
      pending={ask.isPending || !ready}
      onConfirm={() => {
        ask.mutate({ note }, { onSuccess: onDecided });
      }}
      onCancel={onClose}
    >
      <Field label="What we need" hint="Required. The sender reads these words in the letter.">
        {(control) => (
          <textarea
            {...control}
            required
            minLength={NOTE_MIN}
            maxLength={2000}
            rows={4}
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
        ready={ready}
        error={preview.error?.message ?? null}
        onPreview={() => {
          preview.mutate({ template: "awaiting_assets", note });
        }}
      />
      {ask.error === null ? null : <p role="alert">{ask.error.message}</p>}
    </ConfirmDialog>
  );
}
