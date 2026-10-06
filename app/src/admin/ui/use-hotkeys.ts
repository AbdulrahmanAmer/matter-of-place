import { useEffect } from "react";

const TYPING = new Set(["INPUT", "TEXTAREA", "SELECT"]);
const ACTIVATES_ITSELF = new Set(["BUTTON", "A"]);

function ignored(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return true;
  const target = event.target;
  if (!(target instanceof HTMLElement)) return false;
  if (TYPING.has(target.tagName) || target.isContentEditable) return true;
  if (target.closest("dialog[open]") !== null) return true;
  return event.key === "Enter" && ACTIVATES_ITSELF.has(target.tagName);
}

/**
 * Single-key shortcuts for a screen (`j` and `k` move, `Enter` opens, `a`, `d` and `p` act where allowed). Keys
 * are off while a field has focus, inside a dialog, and for Enter on a button or link, which Enter already uses.
 */
export function useHotkeys(bindings: Readonly<Record<string, () => void>>, enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (ignored(event)) return;
      const run = bindings[event.key];
      if (run === undefined) return;
      event.preventDefault();
      run();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [bindings, enabled]);
}
