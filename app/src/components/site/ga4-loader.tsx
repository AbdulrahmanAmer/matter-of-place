import { useEffect } from "react";
import { isAccountPath } from "../../domain/account";
import { track } from "../../lib/analytics";
import { CONSENT_VERSION, consentGranted, onConsentChange, readConsent } from "../../lib/consent";
import { loadGa4 } from "../../lib/ga4";

const GPC_TRACKED = "mop_consent_gpc_tracked";

/** A stored grant that Global Privacy Control overrides is the only grant `consentGranted()` still refuses. */
function overriddenByGpc(): boolean {
  const record = readConsent();
  return record?.version === CONSENT_VERSION && record.analytics && !consentGranted();
}

/** Counts the automatic decline once per session. A click on the notice is counted by the notice, not here. */
function trackGpcOverride(): void {
  try {
    if (!overriddenByGpc() || sessionStorage.getItem(GPC_TRACKED) !== null) return;
    sessionStorage.setItem(GPC_TRACKED, "1");
  } catch {
    return;
  }
  track("consent_set", { analytics: false, via: "gpc" });
}

/** The page's path as the router matches it: decoded where it can be, lower case (`routePath` in the pipeline). */
function matchedPath(pathname: string): string {
  try {
    return decodeURI(pathname).toLowerCase();
  } catch {
    return pathname.toLowerCase();
  }
}

/**
 * Loads Google Analytics on a public page once the visitor has allowed it (GP-02). Mounted only in the public layout
 * `_site.tsx`, so no admin page loads it (FE-02). Renders nothing; with no measurement id it does nothing. A visit that
 * opens on the client room never loads it (ruling H119): its sign-in link carries a token, which a page view would
 * send to Google.
 */
export function Ga4Loader() {
  useEffect(() => {
    const measurementId = import.meta.env.VITE_GA4_MEASUREMENT_ID ?? "";
    if (measurementId === "") return;
    if (isAccountPath(matchedPath(window.location.pathname))) return;
    trackGpcOverride();
    loadGa4(measurementId);
    return onConsentChange(() => {
      loadGa4(measurementId);
    });
  }, []);
  return null;
}
