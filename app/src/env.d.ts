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
  /** Public Instagram profile URL. The footer link renders only when set. */
  readonly VITE_INSTAGRAM_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
