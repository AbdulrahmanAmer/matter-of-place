import { useEffect } from "react";

/** Ref callback that moves focus to the element when it mounts (the first field of an overlay). */
export const focusOnMount = (node: HTMLElement | null) => {
  node?.focus();
};

/**
 * Shared behaviour for overlays: locks page scroll while open and closes on
 * Escape. Used by the header menu, the search overlay and the inquiry dialog.
 */
export function useModal(open: boolean, onClose: () => void) {
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
