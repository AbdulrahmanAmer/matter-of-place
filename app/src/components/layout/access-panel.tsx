import { useRouterState } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  STANDARD,
  onAccessChange,
  onAccessOpen,
  readAccess,
  textSteps,
  visions,
  writeAccess,
  type Access,
} from "../../lib/access";
import { openConsentNotice } from "../../lib/consent";
import { cx } from "../../lib/cx";
import { t } from "../../lib/strings";

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
      {access.hidden ? (
        <button
          ref={tab}
          type="button"
          className="access-tab"
          aria-label={t.access.show}
          title={t.access.show}
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
          aria-label={open ? t.access.close : t.access.open}
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
          <span className="access-hint" aria-hidden="true" data-hint={t.access.open} />
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

type Tile = {
  key: keyof typeof t.access.tiles;
  on: boolean;
  state: string;
  next: () => void;
  /** Dots for a tile with more than two states, filled or not; a plain toggle has none. */
  dots?: boolean[];
  icon: ReactNode;
};

function Panel({
  access,
  update,
  close,
  hide,
}: {
  access: Access;
  update: (next: Partial<Access>) => void;
  close: (returnFocus: boolean) => void;
  hide: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const closeRef = useRef(close);
  closeRef.current = close;
  const s = t.access;
  const pointer = usePointerFine();

  // The listeners are added once, when the panel opens; each choice re-renders it, and focus must stay where it is.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRef.current(true);
    };
    const onPointer = (event: PointerEvent) => {
      const inside = event
        .composedPath()
        .some(
          (node) =>
            node === panel.current ||
            (node instanceof Element && node.hasAttribute("data-access-mark")),
        );
      if (!inside) closeRef.current(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer);
    panel.current?.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer);
    };
  }, []);

  const flag = (key: "contrast" | "spacing" | "font" | "links" | "guide" | "still"): Tile => ({
    key,
    on: access[key],
    state: access[key] ? s.on : s.off,
    next: () => {
      update({ [key]: !access[key] });
    },
    icon: ICONS[key],
  });
  const tiles: Tile[] = [
    {
      key: "text",
      on: access.text !== 0,
      state: s.textSteps[access.text],
      // A scale: two dots past the standard size, filled up to the chosen step.
      dots: [access.text >= 1, access.text >= 2],
      next: () => {
        update({ text: textSteps[(access.text + 1) % textSteps.length] ?? 0 });
      },
      icon: ICONS.text,
    },
    flag("contrast"),
    flag("spacing"),
    flag("font"),
    flag("links"),
    ...(pointer ? [flag("guide")] : []),
    flag("still"),
    {
      key: "vision",
      on: access.vision !== "none",
      state: s.visions[access.vision],
      // A choice: one dot per filter, the chosen one filled.
      dots: visions.slice(1).map((kind) => kind === access.vision),
      next: () => {
        update({
          vision: visions[(visions.indexOf(access.vision) + 1) % visions.length] ?? "none",
        });
      },
      icon: ICONS.vision,
    },
  ];

  return (
    <div
      ref={panel}
      id="access-panel"
      className="access-panel"
      role="dialog"
      aria-modal="false"
      aria-labelledby="access-title"
    >
      <header className="access-head">
        <div>
          <h2 id="access-title" className="access-title">
            {s.title}
          </h2>
          <p className="access-saved">{s.saved}</p>
        </div>
        <button
          type="button"
          className="access-close"
          aria-label={s.close}
          onClick={() => {
            close(true);
          }}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M7 7l10 10M17 7 7 17" />
          </svg>
        </button>
      </header>

      <div className="access-body">
        <Voice />
        <div className="access-tiles">
          {tiles.map((tile) => (
            <button
              key={tile.key}
              type="button"
              className={cx("access-tile", tile.on && "access-tile-on")}
              aria-pressed={tile.dots === undefined ? tile.on : undefined}
              aria-label={`${s.tiles[tile.key]}: ${tile.state}`}
              onClick={tile.next}
            >
              <span className="access-tile-icon" aria-hidden="true">
                {tile.icon}
              </span>
              <span className="access-tile-state" aria-hidden="true">
                {(tile.dots ?? [tile.on]).map((filled, index) => (
                  <span key={index} className={cx("access-dot", filled && "access-dot-on")} />
                ))}
              </span>
              <span className="access-tile-name" aria-hidden="true">
                {s.tiles[tile.key]}
              </span>
              <span className="access-tile-value" aria-hidden="true">
                {tile.state}
              </span>
            </button>
          ))}
        </div>
        <p className="access-note">{s.shortcut}</p>
      </div>

      <footer className="access-foot">
        <button
          type="button"
          className="access-link"
          onClick={() => {
            update({ ...STANDARD, hidden: false });
          }}
        >
          {s.reset}
        </button>
        <button
          type="button"
          className="access-link"
          onClick={() => {
            close(false);
            openConsentNotice();
          }}
        >
          {s.cookies}
        </button>
        <button type="button" className="access-link" onClick={hide}>
          {s.hide}
        </button>
      </footer>
    </div>
  );
}

/** The read-aloud bar: the browser's own voice over the page's main text, or a passage selected first. */
function Voice() {
  const s = t.access;
  const [state, setState] = useState<"idle" | "reading" | "paused">("idle");
  const [unavailable, setUnavailable] = useState(false);
  const pathname = useRouterState({ select: (router) => router.location.pathname });

  useEffect(() => {
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    setState("idle");
  }, [pathname]);
  useEffect(
    () => () => {
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    },
    [],
  );

  const start = () => {
    const selected = window.getSelection()?.toString().trim() ?? "";
    const main = document.querySelector("main")?.innerText ?? "";
    const text = (selected.length > 40 ? selected : main).replace(/\s+/g, " ").trim();
    if (!("speechSynthesis" in window) || text === "") {
      setUnavailable(true);
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text.slice(0, 24_000));
    utterance.lang = document.documentElement.lang || "en";
    utterance.rate = 0.95;
    utterance.onend = () => {
      setState("idle");
    };
    utterance.onerror = () => {
      setState("idle");
    };
    window.speechSynthesis.speak(utterance);
    setState("reading");
  };
  const primary =
    state === "idle"
      ? { label: s.voicePlay, icon: ICONS.play, act: start }
      : state === "reading"
        ? {
            label: s.voicePause,
            icon: ICONS.pause,
            act: () => {
              window.speechSynthesis.pause();
              setState("paused");
            },
          }
        : {
            label: s.voiceResume,
            icon: ICONS.play,
            act: () => {
              window.speechSynthesis.resume();
              setState("reading");
            },
          };

  return (
    <div className="access-voice">
      <button
        type="button"
        className="access-play"
        aria-label={primary.label}
        onClick={primary.act}
      >
        {primary.icon}
      </button>
      <div className="access-voice-text">
        <p className="access-voice-title">
          {state === "idle" ? s.voice : state === "reading" ? s.voiceReading : s.voicePaused}
        </p>
        <p className="access-note" aria-live="polite">
          {unavailable ? s.voiceUnavailable : s.voiceNote}
        </p>
      </div>
      {state !== "idle" && (
        <button
          type="button"
          className="access-link"
          onClick={() => {
            window.speechSynthesis.cancel();
            setState("idle");
          }}
        >
          {s.voiceStop}
        </button>
      )}
    </div>
  );
}

/** A band 96px high that follows the pointer; the page above and below it is dimmed. Mouse only. */
function ReadingGuide() {
  const top = useRef<HTMLDivElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let frame = 0;
    const place = (y: number) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        top.current?.style.setProperty("height", `${String(Math.max(0, y - 48))}px`);
        bottom.current?.style.setProperty("top", `${String(y + 48)}px`);
      });
    };
    const onMove = (event: PointerEvent) => {
      if (event.pointerType === "mouse") place(event.clientY);
    };
    place(window.innerHeight / 2);
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onMove);
    };
  }, []);
  return (
    <div className="access-guide" aria-hidden="true">
      <div ref={top} className="access-guide-dim access-guide-top" />
      <div ref={bottom} className="access-guide-dim access-guide-bottom" />
    </div>
  );
}

function usePointerFine(): boolean {
  const [fine, setFine] = useState(false);
  useEffect(() => {
    setFine(window.matchMedia("(pointer: fine)").matches);
  }, []);
  return fine;
}

const icon = (paths: ReactNode) => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    {paths}
  </svg>
);

/** Every icon on a 24 grid, stroked 1.6, round ends, drawn for this panel. */
const ICONS = {
  text: icon(<path d="M3.5 7V5h10v2M8.5 5v14M13.5 12v-1.5h7V12M17 10.5V19" />),
  contrast: icon(
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 4a8 8 0 0 1 0 16Z" className="access-fill" />
    </>,
  ),
  spacing: icon(<path d="M4 6h11M4 12h11M4 18h11M19.5 5v14M17.5 7l2-2 2 2M17.5 17l2 2 2-2" />),
  font: icon(<path d="M5.5 19 12 5l6.5 14M8 14h8" />),
  links: icon(
    <path d="M10.6 13.4a3.5 3.5 0 0 0 4.95 0l2.83-2.83a3.5 3.5 0 0 0-4.95-4.95l-.7.7M13.4 10.6a3.5 3.5 0 0 0-4.95 0l-2.83 2.83a3.5 3.5 0 0 0 4.95 4.95l.7-.7" />,
  ),
  guide: icon(<path d="M3 5.5h18M3 18.5h18M3 9.5h18v5H3Z" />),
  still: icon(
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M10 9v6M14 9v6" />
    </>,
  ),
  vision: icon(
    <>
      <path d="M2.5 12S6 6 12 6s9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
      <circle cx="12" cy="12" r="2.6" />
    </>,
  ),
  play: icon(<path d="M9 6.5v11l9-5.5Z" className="access-fill" />),
  pause: icon(<path d="M9.5 6.5v11M14.5 6.5v11" />),
} as const;
