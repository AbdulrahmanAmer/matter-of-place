export type Flags = Readonly<Record<string, unknown>>;

// One row per directive. A comment names the slice that needs a source, so a source leaves with it.
const POLICY: Readonly<Record<string, readonly string[]>> = {
  "default-src": ["'self'"],
  "script-src": [
    "'self'",
    "https://challenges.cloudflare.com", // B3: Turnstile widget
    // B17 adds the GA4 hosts for B13's loader and the per-page 'sha256-...' entries.
  ],
  "style-src": [
    "'self'",
    "'unsafe-inline'", // React style attributes
    "https://fonts.googleapis.com", // B17 removes it with the self-hosted fonts (G-014)
  ],
  "font-src": [
    "'self'",
    "https://fonts.gstatic.com", // B17 removes it with the self-hosted fonts (G-014)
  ],
  "img-src": ["'self'", "data:"],
  "media-src": ["'self'"],
  "connect-src": [
    "'self'",
    "https://challenges.cloudflare.com", // B3: Turnstile widget
  ],
  "frame-src": [
    "https://challenges.cloudflare.com", // B3: Turnstile widget
  ],
  "frame-ancestors": ["'none'"],
  "object-src": ["'none'"],
  "base-uri": ["'self'"],
  "form-action": ["'self'"],
};

/**
 * The Content-Security-Policy value. Inline scripts are allowed by hash only, never by a nonce,
 * because HTML is cached (architecture 13 rule 5). `env` and `flags` are part of the frozen
 * signature that B17 and H1 build on; the policy is the same for every environment today.
 */
export function cspFor(_env: string, _flags: Flags, scriptHashes: readonly string[] = []): string {
  return Object.entries(POLICY)
    .map(([directive, sources]) => {
      const extra =
        directive === "script-src" ? scriptHashes.map((hash) => `'sha256-${hash}'`) : [];
      return [directive, ...sources, ...extra].join(" ");
    })
    .join("; ");
}

/** The static security headers of every server response. `X-Robots-Tag` is decided by host in the pipeline. */
export function securityHeaders(env: string, flags: Flags): Record<string, string> {
  return {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy":
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "Content-Security-Policy-Report-Only": cspFor(env, flags),
  };
}
