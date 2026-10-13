import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { onAccessChange, readAccess, writeAccess, type Access } from "../../lib/access";
import { onAccessOpen } from "../../lib/access-events";
import { cx } from "../../lib/cx";
import { accessText } from "../../lib/access-strings";

// The panel's body loads on first use, so a page that never opens it carries only the mark (bundle budget, FE-03).
const Panel = lazy(() => import("./access-dialog").then((m) => ({ default: m.Panel })));
const ReadingGuide = lazy(() =>
  import("./access-dialog").then((m) => ({ default: m.ReadingGuide })),
);

/**
 * The accessibility settings (operator, 2026-10-13). A round Obsidian mark at the bottom right opens a panel of eight
 * settings and a read-aloud bar; every choice stays on this device (src/lib/access.ts) and is drawn before the first
 * paint. The panel is a non-modal dialog on a wide screen and a bottom sheet on a phone: Escape, the close button or a
 * click outside closes it, and focus returns to the mark. Alt + A or the footer's link opens it from anywhere, and
 * brings back a hidden mark. Nothing here changes what a screen reader hears; the page itself carries that.
 */
export function AccessPanel() {
  const [access, setAccess] = useState<Access | null>(null);
  const [open, setOpen] = useState(false);
  const mark = useRef<HTMLButtonElement>(null);
  const tab = useRef<HTMLButtonElement>(null);
  const focusAfter = useRef<"mark" | "tab" | null>(null);

  // Nothing is drawn until the stored choice is read, so a hidden mark never flashes on load.
  useEffect(() => {
    setAccess(readAccess());
    const stopChange = onAccessChange(() => {
      setAccess(readAccess());
    });
    const reveal = () => {
      const current = readAccess();
      if (current.hidden) writeAccess({ ...current, hidden: false });
      setOpen(true);
    };
    const stopOpen = onAccessOpen(reveal);
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey && !event.ctrlKey && !event.metaKey && event.code === "KeyA") {
        event.preventDefault();
        reveal();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      stopChange();
      stopOpen();
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  useEffect(() => {
    const target = focusAfter.current;
    focusAfter.current = null;
    if (target === "mark") mark.current?.focus({ preventScroll: true });
    if (target === "tab") tab.current?.focus({ preventScroll: true });
  });

  if (access === null) return null;

  const update = (next: Partial<Access>) => {
    writeAccess({ ...access, ...next });
  };
  const close = (returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) focusAfter.current = "mark";
  };

  return (
    <div className="access" data-print="hide">
      <Suspense fallback={null}>
        {access.guide && <ReadingGuide />}
        {open && !access.hidden && (
          <Panel
            access={access}
            update={update}
            close={close}
            hide={() => {
              setOpen(false);
              focusAfter.current = "tab";
              update({ hidden: true });
            }}
          />
        )}
      </Suspense>
      {access.hidden ? (
        <button
          ref={tab}
          type="button"
          className="access-tab"
          aria-label={accessText.show}
          title={accessText.show}
          onClick={() => {
            focusAfter.current = "mark";
            update({ hidden: false });
          }}
        >
          <Figure />
        </button>
      ) : (
        <button
          ref={mark}
          type="button"
          className={cx("access-mark", open && "access-mark-open")}
          data-access-mark=""
          aria-expanded={open}
          aria-controls={open ? "access-panel" : undefined}
          aria-label={open ? accessText.close : accessText.open}
          onClick={() => {
            if (open) close(true);
            else setOpen(true);
          }}
        >
          <svg className="access-ring" viewBox="0 0 56 56" aria-hidden="true">
            <circle cx="28" cy="28" r="23" />
          </svg>
          <Figure />
          <svg className="access-x" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M7 7l10 10M17 7 7 17" />
          </svg>
          <span className="access-hint" aria-hidden="true" data-hint={accessText.open} />
        </button>
      )}
    </div>
  );
}

/** The universal accessibility figure on a 24 grid, stroked 1.6. */
function Figure() {
  return (
    <svg className="access-figure" viewBox="0 0 24 24" aria-hidden="true">
      {/* The doorway: an arch 11 wide with its apex at y 5, on a threshold 15 long; the emblem's lighter plane. */}
      <path
        className="access-door"
        pathLength={1}
        d="M4.5 21h15M6.5 21V10.5a5.5 5.5 0 0 1 11 0V21"
      />
      {/* The figure standing in it: head r 1.5 at y 8.6, open arms at 12.1, feet 1.3 above the threshold. */}
      <circle cx="12" cy="8.6" r="1.5" />
      <path d="M8.6 12.1q3.4 1.1 6.8 0M12 12.9v3.2M12 16.1l-2 3.6M12 16.1l2 3.6" />
    </svg>
  );
}
