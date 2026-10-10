/// <reference types="vite/client" />

/**
 * Public build-time configuration. Every value here ships to the browser, so
 * only non-secret settings belong in `VITE_*` variables. Server secrets live
 * with the backend, never in this frontend.
 */
interface ImportMetaEnv {
  /** Absolute origin of the deployed site, used for canonical URLs. */
  readonly VITE_SITE_URL?: string;
  /** Base URL of the Matter of Place API. When unset, services run locally. */
  readonly VITE_API_BASE_URL?: string;
  /** Public Cloudflare Turnstile site key. The secret key stays on the server. */
  readonly VITE_TURNSTILE_SITE_KEY?: string;
  /** Public Google Analytics 4 measurement id (G-...). Empty or unset: the loader does nothing. */
  readonly VITE_GA4_MEASUREMENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
