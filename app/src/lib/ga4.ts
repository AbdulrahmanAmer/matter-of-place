import { consentGranted } from "./consent";

// The only analytics script (G31): gtag.js straight from Google, never a Tag Manager container. It is injected by
// `Ga4Loader` on a public page after the visitor's consent, never in the server HTML (GP-02, FE-02).

const GTAG_SRC = "https://www.googletagmanager.com/gtag/js";
const IDLE_TIMEOUT_MS = 2000;

const loaded = () => document.querySelector(`script[src^="${GTAG_SRC}"]`) !== null;

function gtag(_command: string, ..._values: unknown[]): void {
  // eslint-disable-next-line prefer-rest-params -- gtag.js acts only on `arguments` objects in the dataLayer, never on arrays
  (window.dataLayer ??= []).push(arguments);
}

function whenIdle(run: () => void): void {
  if ("requestIdleCallback" in window)
    window.requestIdleCallback(run, { timeout: IDLE_TIMEOUT_MS });
  else setTimeout(run, 1);
}

/**
 * The events that count as leads in GA4, where each is marked a key event (operator, 2026-10-19). Every other event
 * stays first-party only (`/events`).
 */
export const ga4LeadEvents = [
  "contact_inquiry",
  "submit_property",
  "interest_signup",
  "newsletter_signup",
  "package_interest",
] as const;

/**
 * Sends a lead to GA4 by its name alone, so no address, name or message leaves for Google, and only while the visitor's
 * consent holds and gtag.js is in the page. Returns whether it was sent.
 */
export function sendGa4Lead(event: string): boolean {
  if (!(ga4LeadEvents as readonly string[]).includes(event) || !consentGranted() || !loaded())
    return false;
  gtag("event", event);
  return true;
}

/**
 * Loads gtag.js once, after the browser is idle, while `consentGranted()` holds; a call after the script is in the
 * page does nothing. Google signals and ad personalization are off in the first `config` entry.
 */
export function loadGa4(measurementId: string): void {
  if (measurementId === "" || !consentGranted() || loaded()) return;
  whenIdle(() => {
    if (loaded() || !consentGranted()) return;
    gtag("js", new Date());
    gtag("config", measurementId, {
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
    });
    const script = document.createElement("script");
    script.async = true;
    script.src = `${GTAG_SRC}?id=${encodeURIComponent(measurementId)}`;
    document.head.append(script);
  });
}
