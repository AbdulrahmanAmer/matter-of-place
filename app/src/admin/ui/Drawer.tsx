import type { ReactNode } from "react";
import { Dialog } from "./Dialog";

/** Details beside a list without leaving it: the shared dialog, placed at the edge. */
export function Drawer({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onClose={onClose} label={title} variant="drawer">
      <div className="admin-dialog__panel">
        <div className="admin-dialog__head">
          <h2>{title}</h2>
          <button type="button" className="admin-button admin-button--quiet" onClick={onClose}>
            Close
          </button>
        </div>
        {children}
      </div>
    </Dialog>
  );
}
