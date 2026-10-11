import { useEffect, useRef, useState, type MouseEvent } from "react";
import { Link } from "@tanstack/react-router";
import { track } from "../../lib/analytics";
import {
  CONSENT_VERSION,
  onConsentChange,
  onConsentNoticeOpen,
  readConsent,
  writeConsent,
} from "../../lib/consent";
import { cx } from "../../lib/cx";
import { t } from "../../lib/strings";

const decided = () => readConsent()?.version === CONSENT_VERSION;

/**
 * The analytics choice (GP-02, ruling H85, operator 2026-10-11: "like any other cookies pop up"): a card floating at the
 * bottom of the screen on every page. No dialog and no focus taken. Necessary cookies are not a
 * choice and are not mentioned here. It renders nothing until the browser has read the stored choice, so the server
 * HTML is the same for every visitor, and nothing once a choice is stored until the footer's cookie settings control
 * asks again. While the bar shows, it publishes its height as `--consent-bar-h`, which pads the page and its scroll
 * position so the bar never covers the last content or a focused element.
 */
export function ConsentNotice() {
  const [open, setOpen] = useState(false);
  const bar = useRef<HTMLElement>(null);

  useEffect(() => {
    setOpen(!decided());
    const stopOpen = onConsentNoticeOpen(() => {
      setOpen(true);
    });
    // A choice made elsewhere on the page, as on /privacy-choices, answers the notice too.
    const stopChange = onConsentChange(() => {
      setOpen(false);
    });
    return () => {
      stopOpen();
      stopChange();
    };
  }, []);

  useEffect(() => {
    const node = bar.current;
    if (!open || node === null) return;
    const root = document.documentElement;
    const publish = () => {
      root.style.setProperty("--consent-bar-h", `${String(node.offsetHeight)}px`);
    };
    publish();
    const watch = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(publish);
    watch?.observe(node);
    return () => {
      watch?.disconnect();
      root.style.removeProperty("--consent-bar-h");
    };
  }, [open]);

  if (!open) return null;

  const choose = (analytics: boolean) => (event: MouseEvent<HTMLButtonElement>) => {
    // The listener above closes the notice once the choice is stored; a browser that refuses the store closes it here.
    if (!writeConsent(analytics)) setOpen(false);
    track("consent_set", { analytics });
    // A click with no pointer is the keyboard: the button is leaving, so focus goes where the choice can be changed.
    if (event.detail === 0) document.getElementById("consent-change")?.focus();
  };

  return (
    <section ref={bar} className={cx("consent-notice", "consent-bar")} aria-label={t.consent.label}>
      <p className="consent-title">{t.consent.title}</p>
      <p className="consent-text">
        {t.consent.text} <Link to="/privacy">{t.consent.link}</Link>
      </p>
      <div className="consent-actions">
        <button type="button" className="consent-allow" onClick={choose(true)}>
          {t.consent.accept}
        </button>
        <button type="button" className="consent-decline" onClick={choose(false)}>
          {t.consent.decline}
        </button>
      </div>
    </section>
  );
}
