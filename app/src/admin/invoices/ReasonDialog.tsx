import { useState, type ReactNode } from "react";
import { Dialog } from "../ui/Dialog";
import { Field } from "../ui/Field";
import { useSubmit } from "./use-submit";

const MIN = 3;
const MAX = 500;

function ReasonForm({
  title,
  confirmLabel,
  danger,
  canSubmit,
  intro,
  onSubmit,
  onClose,
  children,
}: {
  title: string;
  confirmLabel: string;
  danger: boolean;
  canSubmit: boolean;
  intro: string;
  onSubmit: (reason: string) => Promise<unknown>;
  onClose: () => void;
  children: ReactNode;
}) {
  const [reason, setReason] = useState("");
  const { pending, error, submit } = useSubmit(onSubmit, onClose);
  const trimmed = reason.trim();

  return (
    <form
      className="admin-dialog__panel"
      data-print="hide"
      onSubmit={(event) => {
        event.preventDefault();
        void submit(trimmed);
      }}
    >
      <div className="admin-dialog__head">
        <h2>{title}</h2>
      </div>
      <div className="admin-dialog__body">
        <p>{intro}</p>
        {children}
        <Field
          label="Reason"
          hint={`${String(MIN)} to ${String(MAX)} characters. It stays on the record.`}
          {...(error === null ? {} : { error })}
        >
          {(control) => (
            <textarea
              {...control}
              rows={3}
              maxLength={MAX}
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
              }}
            />
          )}
        </Field>
      </div>
      <div className="admin-actions">
        <button
          type="submit"
          className={danger ? "admin-button admin-button--danger" : "admin-button"}
          disabled={pending || trimmed.length < MIN || !canSubmit}
        >
          {confirmLabel}
        </button>
        <button type="button" className="admin-button admin-button--quiet" onClick={onClose}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/**
 * A quiet button that opens a dialog asking for a reason of 3 to 500 characters and then runs `onSubmit`; the
 * dialog closes when that resolves and stays open, with the message, when it fails.
 */
export function ReasonDialog({
  trigger,
  title,
  confirmLabel,
  intro,
  danger = false,
  canSubmit = true,
  onSubmit,
  children,
}: {
  trigger: string;
  title: string;
  confirmLabel: string;
  intro: string;
  danger?: boolean;
  /** False while a field the caller adds in `children` is not filled in. */
  canSubmit?: boolean;
  onSubmit: (reason: string) => Promise<unknown>;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const close = () => {
    setOpen(false);
  };
  return (
    <>
      <button
        type="button"
        className="admin-button admin-button--quiet"
        data-print="hide"
        onClick={() => {
          setOpen(true);
        }}
      >
        {trigger}
      </button>
      <Dialog open={open} onClose={close} label={title}>
        <ReasonForm
          title={title}
          confirmLabel={confirmLabel}
          danger={danger}
          canSubmit={canSubmit}
          intro={intro}
          onSubmit={onSubmit}
          onClose={close}
        >
          {children}
        </ReasonForm>
      </Dialog>
    </>
  );
}
