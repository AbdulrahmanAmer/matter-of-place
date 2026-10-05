import { useEffect, useRef } from "react";

/** Ref callback that moves focus to the element when it mounts (the first field of an overlay). */
export const focusOnMount = (node: HTMLElement | null) => {
  node?.focus();
};

/**
 * Shared behaviour for overlays: locks page scroll while open, closes on
 * Escape and gives focus back to the element that opened it. Used by the
 * header menu, the search overlay and the inquiry dialog.
 */
export function useModal(open: boolean, onClose: () => void) {
  const opener = useRef<Element | null>(null);
  // Read while rendering: by the first effect the overlay's own field has already taken focus.
  if (open && opener.current === null && typeof document !== "undefined") {
    opener.current = document.activeElement;
  }

  useEffect(() => {
    if (!open) return;
    return () => {
      if (opener.current instanceof HTMLElement) opener.current.focus();
      opener.current = null;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);
}
