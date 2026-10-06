import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The one modal of the console (R41), on the native `<dialog>`: the browser makes everything behind it inert and
 * reports Escape as a cancel, which asks the parent to close it. Tab is also kept inside by hand, so focus never
 * leaves for the browser's own controls, and focus goes back to what opened it. The drawer and the confirm dialog
 * are this with another placement.
 */
export function Dialog({
  open,
  onClose,
  label,
  variant = "modal",
  children,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  variant?: "modal" | "drawer";
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const node = dialog.current;
    if (node === null || !open) return;
    const opener = document.activeElement;
    if (!node.open) node.showModal();
    if (!node.contains(document.activeElement)) node.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    return () => {
      if (node.open) node.close();
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, [open]);

  const keepTabInside = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key !== "Tab") return;
    const stops = [...event.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)];
    const first = stops[0];
    const last = stops.at(-1);
    if (first === undefined || last === undefined) {
      event.preventDefault();
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    // The dialog element is the keyboard and backdrop surface of its own overlay; every control inside it is a real button.
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Tab handling and a click on the backdrop belong to the dialog element itself
    <dialog
      ref={dialog}
      className={`admin-dialog admin-dialog--${variant}`}
      aria-label={label}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={keepTabInside}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {open ? children : null}
    </dialog>
  );
}
