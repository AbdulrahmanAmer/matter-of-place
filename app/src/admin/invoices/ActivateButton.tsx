import { useState } from "react";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { useSubmit } from "./use-submit";

function ActivateConfirm({
  onActivate,
  onClose,
}: {
  onActivate: () => Promise<unknown>;
  onClose: () => void;
}) {
  const { pending, error, submit } = useSubmit(onActivate, onClose);
  return (
    <ConfirmDialog
      open
      title="Activate this request"
      confirmLabel="Activate"
      pending={pending}
      onConfirm={() => {
        void submit(undefined);
      }}
      onCancel={onClose}
    >
      <p>
        The request moves to Scheduled and its property is created from it. The photographs are
        copied in the background.
      </p>
      {error === null ? null : <p role="alert">{error}</p>}
    </ConfirmDialog>
  );
}

/** Activates a paid or waived request after one confirmation. */
export function ActivateButton({ onActivate }: { onActivate: () => Promise<unknown> }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="admin-button"
        data-print="hide"
        onClick={() => {
          setOpen(true);
        }}
      >
        Activate
      </button>
      {open ? (
        <ActivateConfirm
          onActivate={onActivate}
          onClose={() => {
            setOpen(false);
          }}
        />
      ) : null}
    </>
  );
}
