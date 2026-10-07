import { siteConfig } from "../config/site";
import { reportClientError } from "./report-error";

/**
 * Registers the offline worker on the site's own host only: production and each `pr-<n>` preview, whose build
 * sets its `VITE_SITE_URL`; never localhost, `127.0.0.1` or vite dev. The site works the same without it.
 */
export function registerServiceWorker(): void {
  if (!("serviceWorker" in navigator)) return;
  if (location.hostname !== new URL(siteConfig.url).hostname) return;
  navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((error: unknown) => {
    reportClientError(error, { route: "/sw.js" });
  });
}
