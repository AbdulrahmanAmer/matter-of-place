import { useSyncExternalStore, type MouseEvent } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { PageIntro } from "../components/site/page-intro";
import { track } from "../lib/analytics";
import {
  CONSENT_VERSION,
  consentGranted,
  onConsentChange,
  readConsent,
  writeConsent,
} from "../lib/consent";
import { pageHead } from "../lib/seo";
import { pageDescription } from "../lib/seo-copy";
import { t } from "../lib/strings";

export const Route = createFileRoute("/_site/privacy-choices")({
  head: () =>
    pageHead({
      title: t.privacyChoices.title,
      description: pageDescription("privacy-choices"),
      path: "/privacy-choices",
      noindex: true,
    }),
  component: PrivacyChoicesPage,
});

type ChoiceState = "on" | "off" | "none";

function choiceState(): ChoiceState {
  if (readConsent()?.version !== CONSENT_VERSION) return "none";
  return consentGranted() ? "on" : "off";
}

// The server and the first client render show no state, so the cached page is the same for every visitor.
const noState = () => undefined;

function PrivacyChoicesPage() {
  const state = useSyncExternalStore(onConsentChange, choiceState, noState);

  // With JavaScript the choice is stored in both places here; when the browser refuses storage, the link goes on to
  // /api/consent, which keeps the choice in the cookie.
  const choose = (analytics: boolean) => (event: MouseEvent) => {
    if (!writeConsent(analytics)) return;
    event.preventDefault();
    track("consent_set", { analytics });
  };

  return (
    <main>
      <PageIntro eyebrow="PRIVACY" title={t.privacyChoices.title} text={t.consent.text} />
      <div className="copy-page">
        <p role="status" className="choice-state">
          {state === undefined ? "" : t.privacyChoices[state]}
        </p>
        <div className="consent-actions">
          <a className="consent-allow" href="/api/consent?set=accept" onClick={choose(true)}>
            {t.consent.accept}
          </a>
          <a className="consent-decline" href="/api/consent?set=decline" onClick={choose(false)}>
            {t.consent.decline}
          </a>
        </div>
        <p className="choice-links">
          <Link to="/cookies">{t.cookies.title}</Link>
          <Link to="/legal" hash="privacy">
            {t.consent.link}
          </Link>
        </p>
      </div>
    </main>
  );
}
