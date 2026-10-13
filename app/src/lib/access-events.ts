// Opening the accessibility panel from anywhere (the footer link, Alt + A). Kept apart from src/lib/access.ts so the
// footer can ask for the panel without loading it: the panel itself loads after the page (bundle budget, FE-03).

const OPEN = "mop-access-open";

/** Opens the panel, and brings back a mark the visitor hid. */
export function openAccess(): void {
  window.dispatchEvent(new Event(OPEN));
}

export function onAccessOpen(listener: () => void): () => void {
  window.addEventListener(OPEN, listener);
  return () => {
    window.removeEventListener(OPEN, listener);
  };
}
