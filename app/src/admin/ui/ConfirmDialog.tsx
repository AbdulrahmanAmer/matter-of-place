import type { ReactNode } from "react";
import { Dialog } from "./Dialog";

/**
 * Every outward or destructive action confirms once here and then runs as a job the person can watch. While
 * `pending` is true the confirm button is off, so a second click cannot send the action twice.
 */
export function ConfirmDialog({
  open,
  title,
  confirmLabel,
  danger = false,
  pending = false,
  onConfirm,
  onCancel,
  children,
}: {
  open: boolean;
  title: string;
  confirmLabel: string;
  danger?: boolean;
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
}) {
  return (
    <Dialog open={open} onClose={onCancel} label={title}>
      <div className="admin-dialog__panel">
        <div className="admin-dialog__head">
          <h2>{title}</h2>
        </div>
        <div className="admin-dialog__body">{children}</div>
        <div className="admin-actions">
          <button
            type="button"
            className={danger ? "admin-button admin-button--danger" : "admin-button"}
            disabled={pending}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
          <button type="button" className="admin-button admin-button--quiet" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </Dialog>
  );
}
