import { useEffect, useState, type MouseEvent } from "react";
import { Link } from "@tanstack/react-router";
import { track } from "../../lib/analytics";
import {
  CONSENT_VERSION,
  onConsentChange,
  onConsentNoticeOpen,
  readConsent,
  writeConsent,
} from "../../lib/consent";
import { t } from "../../lib/strings";

const decided = () => readConsent()?.version === CONSENT_VERSION;

/**
 * The analytics choice (GP-02): one row at the top of the footer, in normal flow, with no dialog and no focus
 * taken. It renders nothing until the browser has read the stored choice, so the server HTML is the same for
 * every visitor, and nothing once a choice is stored until the footer's cookie settings control asks again.
 */
export function ConsentNotice() {
  const [open, setOpen] = useState(false);

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

  if (!open) return null;

  const choose = (analytics: boolean) => (event: MouseEvent<HTMLButtonElement>) => {
    // The listener above closes the notice once the choice is stored; a browser that refuses the store closes it here.
    if (!writeConsent(analytics)) setOpen(false);
    track("consent_set", { analytics });
    // A click with no pointer is the keyboard: the button is leaving, so focus goes where the choice can be changed.
    if (event.detail === 0) document.getElementById("consent-change")?.focus();
  };

  return (
    <section className="consent-notice" aria-label={t.consent.label}>
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
