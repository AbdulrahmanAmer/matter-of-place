import { useState } from "react";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { Field } from "../ui/Field";

const WORD = "REVOKE";

/**
 * Revokes every live agent key at once. The person types the word first, so it is never one stray click; each key
 * then fails on its next request.
 */
export function RevokeAllDialog({
  open,
  pending,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [typed, setTyped] = useState("");
  const close = () => {
    setTyped("");
    onCancel();
  };
  return (
    <ConfirmDialog
      open={open}
      title="Revoke every agent key"
      confirmLabel="Revoke all keys"
      danger
      pending={pending || typed !== WORD}
      onConfirm={() => {
        setTyped("");
        onConfirm();
      }}
      onCancel={close}
    >
      <p>Every agent stops working on its next request. New keys can be issued afterwards.</p>
      <Field label={`Type ${WORD} to confirm`}>
        {(control) => (
          <input
            {...control}
            autoComplete="off"
            value={typed}
            onChange={(event) => {
              setTyped(event.target.value);
            }}
          />
        )}
      </Field>
    </ConfirmDialog>
  );
}
