import { useEffect, useRef, type RefObject } from "react";

/** Ref callback that moves focus to the element when it mounts (the first field of an overlay). */
export const focusOnMount = (node: HTMLElement | null) => {
  node?.focus();
};

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const focusableIn = (container: HTMLElement) =>
  [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (element) => element.getClientRects().length > 0,
  );

/**
 * Shared behaviour for overlays: locks page scroll while open, keeps Tab and Shift+Tab inside the container,
 * closes on Escape and gives focus back to the element that opened it. Used by the header menu, the search
 * overlay and the inquiry dialog.
 */
export function useModal(
  open: boolean,
  onClose: () => void,
  containerRef: RefObject<HTMLElement | null>,
) {
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

  // A container whose own field did not take focus gets it on its first control.
  useEffect(() => {
    const container = containerRef.current;
    if (open && container && !container.contains(document.activeElement)) {
      focusableIn(container)[0]?.focus();
    }
  }, [open, containerRef]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      const container = containerRef.current;
      if (event.key !== "Tab" || !container) return;
      const stops = focusableIn(container);
      const first = stops[0];
      const last = stops[stops.length - 1];
      if (!first || !last) return;
      const active = document.activeElement;
      if (!container.contains(active) || (event.shiftKey ? active === first : active === last)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose, containerRef]);
}
