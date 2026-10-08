import type { MouseEvent } from "react";
import { Link } from "@tanstack/react-router";
import { Emblem } from "../brand/emblem";
import { siteConfig } from "../../config/site";
import { openConsentNotice } from "../../lib/consent";
import { t } from "../../lib/strings";
import { ConsentNotice } from "./consent-notice";

// A real link to /privacy-choices; with JavaScript the same click reopens the notice in place.
// A modified click is the visitor opening the page in a new tab or window, so the browser keeps it.
function reopenNotice(event: MouseEvent) {
  if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)
    return;
  event.preventDefault();
  openConsentNotice();
}

export function Footer() {
  const groups = t.footer.groups;
  return (
    <footer className="site-footer" data-print="hide">
      <div className="hf-inner">
        <ConsentNotice />
        <noscript>
          <section className="consent-notice" aria-label={t.consent.label}>
            <p className="consent-text">
              {t.consent.text}{" "}
              <Link to="/legal" hash="privacy">
                {t.consent.link}
              </Link>
            </p>
            <div className="consent-actions">
              <a className="consent-allow" href="/api/consent?set=accept">
                {t.consent.accept}
              </a>
              <a className="consent-decline" href="/api/consent?set=decline">
                {t.consent.decline}
              </a>
            </div>
          </section>
        </noscript>
        <div className="footer-top">
          <Link to="/" className="footer-brand" aria-label={t.header.home}>
            <Emblem className="footer-emblem" />
            <span className="footer-name">{siteConfig.name}</span>
          </Link>
          <p className="footer-statement">{t.footer.statement}</p>
        </div>

        <div className="footer-grid">
          <nav className="footer-col" aria-label={groups.place}>
            <h3>{groups.place}</h3>
            <Link to="/properties">{t.nav.properties}</Link>
            <Link to="/$market" params={{ market: "california" }}>
              {t.nav.california}
            </Link>
            <Link to="/$market" params={{ market: "new-york" }}>
              {t.nav.newYork}
            </Link>
            <Link to="/$market" params={{ market: "florida" }}>
              {t.nav.florida}
            </Link>
          </nav>
          <nav className="footer-col" aria-label={groups.editorial}>
            <h3>{groups.editorial}</h3>
            <Link to="/stories">{t.nav.stories}</Link>
            <Link to="/editorial-standard">{t.nav.standard}</Link>
            <Link to="/about">{t.nav.about}</Link>
          </nav>
          <nav className="footer-col" aria-label={groups.professionals}>
            <h3>{groups.professionals}</h3>
            <Link to="/exposure">{t.nav.exposure}</Link>
            <Link to="/submit">{t.nav.submit}</Link>
            <Link to="/faq">{t.nav.faq}</Link>
          </nav>
          <nav className="footer-col" aria-label={groups.company}>
            <h3>{groups.company}</h3>
            <Link to="/contact">{t.nav.contact}</Link>
            <Link to="/legal" hash="privacy">
              {t.nav.privacy}
            </Link>
            <Link to="/legal" hash="terms">
              {t.nav.terms}
            </Link>
            <Link to="/privacy-choices" id="consent-change" onClick={reopenNotice}>
              {t.consent.change}
            </Link>
            {siteConfig.social.instagram && (
              <a href={siteConfig.social.instagram} rel="noopener noreferrer" target="_blank">
                {t.nav.instagram}
              </a>
            )}
          </nav>
        </div>

        <div className="footer-bottom">
          <span>
            {siteConfig.name} · {t.footer.line}
          </span>
          <span>
            © {new Date().getFullYear()} {siteConfig.name}
          </span>
        </div>
      </div>
    </footer>
  );
}
