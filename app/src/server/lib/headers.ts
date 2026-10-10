import { sha256Base64 } from "./crypto";
import { CSP_INLINE_ALLOWLIST } from "./csp-allowlist";
import { sentryOptions } from "./env";
import { readVar } from "./runtime-env";
import { captureException } from "./sentry";
import { waitUntilOf } from "./wait-until";

export type Flags = Readonly<Record<string, unknown>>;

/** Who may frame a response: nobody, the same origin (a preview page in B7's editor) or the admin's own frames. */
export type Framing = "none" | "self" | "admin";

/** The SHA-256 (base64) of each inline script a policy admits and of each inline style element. */
export interface PageHashes {
  scripts: readonly string[];
  styles: readonly string[];
}

type Render = (request: Request, requestId: string) => Promise<Response>;

const TURNSTILE = "https://challenges.cloudflare.com";
const GA4_CONNECT = [
  "https://*.google-analytics.com",
  "https://*.analytics.google.com",
  "https://*.googletagmanager.com",
];
const REPORT_PATH = "/api/public/csp-report";
const FONT_PRELOADS = [
  "/fonts/jost-latin-wght-normal.woff2",
  "/fonts/cormorant-garamond-latin-wght-normal.woff2",
];

// One row per directive. A comment names the slice that needs a source, so a source leaves with it.
const POLICY: Readonly<Record<string, readonly string[]>> = {
  "default-src": ["'self'"],
  "script-src": [
    "'self'",
    TURNSTILE, // B3: Turnstile widget
    // The exact path, never a wildcard host (SEC-03 (3)): B13's Ga4Loader injects gtag.js after consent.
    "https://www.googletagmanager.com/gtag/js",
  ],
  "style-src": ["'self'"],
  "img-src": [
    "'self'",
    "data:",
    "https://*.google-analytics.com",
    "https://*.googletagmanager.com",
  ],
  "font-src": ["'self'"],
  "media-src": ["'self'"],
  "connect-src": [
    "'self'",
    TURNSTILE, // B3: Turnstile widget
    ...GA4_CONNECT,
  ],
  "frame-src": [TURNSTILE],
  "frame-ancestors": ["'none'"],
  "base-uri": ["'self'"],
  "form-action": ["'self'"],
  "object-src": ["'none'"],
  "upgrade-insecure-requests": [],
  "report-uri": [REPORT_PATH],
  "report-to": ["csp"],
};

/** The browser uploads photographs straight to signed Storage URLs on the project's own origin (B3, E2E-02). */
function supabaseOrigin(): string[] {
  const url = readVar("SUPABASE_URL");
  return url !== undefined && URL.canParse(url) ? [new URL(url).origin] : [];
}

const hashSources = (hashes: readonly string[]): string[] =>
  hashes.map((hash) => `'sha256-${hash}'`);

/**
 * The Content-Security-Policy value. Inline scripts and styles are allowed by hash only, never by a nonce,
 * because HTML is cached (architecture 13 rule 5). The policy does not vary with `env`; the `csp_enforce` flag decides
 * the header's name (`policyHeaderName`) and whether `upgrade-insecure-requests` is sent, a directive a browser
 * ignores, with a console error, in a report-only policy. `connect-src` carries the origin of this deployment's
 * SUPABASE_URL (none when the variable is absent). Photographs come from our own origin, so `img-src` names no media host.
 */
export function cspFor(
  _env: string,
  flags: Flags,
  hashes: Partial<PageHashes> = {},
  options: { framing?: Framing } = {},
): string {
  const framing = options.framing ?? "none";
  const extra: Record<string, string[]> = {
    "script-src": hashSources(hashes.scripts ?? []),
    "style-src": hashSources(hashes.styles ?? []),
    "connect-src": supabaseOrigin(),
    "frame-src": framing === "admin" ? ["'self'"] : [],
  };
  return Object.entries(POLICY)
    .filter(
      ([directive]) => directive !== "upgrade-insecure-requests" || flags["csp_enforce"] === true,
    )
    .map(([directive, sources]) => {
      const own = directive === "frame-ancestors" && framing === "self" ? ["'self'"] : sources;
      return [directive, ...own, ...(extra[directive] ?? [])].join(" ");
    })
    .join("; ");
}

/** The policy is enforced once `csp_enforce` is on (H1 flips it); until then it only reports. */
function policyHeaderName(flags: Flags): string {
  return flags["csp_enforce"] === true
    ? "Content-Security-Policy"
    : "Content-Security-Policy-Report-Only";
}

/**
 * The static security headers of every server response. `X-Robots-Tag` is decided by host in the pipeline.
 * `Cache-Control` is not set here: the pipeline, the cache module and `public/_headers` own it (invariant 4).
 */
export function securityHeaders(
  env: string,
  flags: Flags,
  framing: Framing = "none",
): Record<string, string> {
  return {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": framing === "self" ? "SAMEORIGIN" : "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy":
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-site",
    "X-DNS-Prefetch-Control": "off",
    "Reporting-Endpoints": `csp="${REPORT_PATH}"`,
    [policyHeaderName(flags)]: cspFor(env, flags, {}, { framing }),
  };
}

const SCRIPT = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
const STYLE = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
const LINK = /<link\b[^>]*>/gi;
const EXECUTABLE_TYPE = /^(?:module|(?:text|application)\/(?:x-)?(?:java|ecma)script)$/i;

/**
 * The text a browser hashes is the text its parser produced, not the bytes sent: input preprocessing turns CR and
 * CRLF into LF, and the tokenizer turns each NUL in script or style data into U+FFFD. TanStack writes NUL into its
 * bootstrap script (match ids such as `\u0000_site\u0000`), so the raw bytes would never match.
 */
const parsedText = (text: string): string => text.replace(/\r\n?/g, "\n").replace(/\0/g, "\uFFFD");

const attribute = (tag: string, name: string): string | undefined => {
  const match = new RegExp(`\\s${name}=(?:"([^"]*)"|'([^']*)')`, "i").exec(tag);
  return match?.[1] ?? match?.[2];
};

/**
 * Hashes the inline code of a rendered page, once, on a cache miss (SEC-03 (2)). Every inline style element is
 * hashed. A script is hashed only when it is executable and either carries TanStack's `class="$tsr"` marker or
 * its exact text is an entry of `CSP_INLINE_ALLOWLIST`; a data block (`application/ld+json`, `application/json`)
 * needs no hash, and any other executable inline script is left out, which an enforcing policy blocks, and
 * counted in `unexpected`.
 */
export async function inlineHashes(html: string): Promise<PageHashes & { unexpected: number }> {
  const scripts: string[] = [];
  let unexpected = 0;
  for (const [, attrs = "", text = ""] of html.matchAll(SCRIPT)) {
    const type = attribute(attrs, "type");
    if (
      attribute(attrs, "src") !== undefined ||
      (type !== undefined && !EXECUTABLE_TYPE.test(type))
    ) {
      continue;
    }
    const marked = attribute(attrs, "class")?.split(/\s+/).includes("$tsr") === true;
    if (marked || CSP_INLINE_ALLOWLIST.includes(text)) scripts.push(parsedText(text));
    else unexpected += 1;
  }
  const styles = [...html.matchAll(STYLE)].map(([, text = ""]) => parsedText(text));
  const hashed = await Promise.all([...scripts, ...styles].map(sha256Base64));
  return {
    scripts: [...new Set(hashed.slice(0, scripts.length))],
    styles: [...new Set(hashed.slice(scripts.length))],
    unexpected,
  };
}

/**
 * The `Link` header of a page: the two text faces and the page's own stylesheets as preloads (Cloudflare turns
 * them into Early Hints), and the one preconnect, to Turnstile. Photographs share our origin, so none is named.
 */
function pageLinks(html: string): string {
  const stylesheets = [...html.matchAll(LINK)].flatMap(([tag]) => {
    const href = attribute(tag, "href");
    return attribute(tag, "rel") === "stylesheet" && href?.startsWith("/") === true ? [href] : [];
  });
  return [
    ...FONT_PRELOADS.map(
      (path) => `<${path}>; rel=preload; as=font; type="font/woff2"; crossorigin`,
    ),
    ...stylesheets.map((href) => `<${href}>; rel=preload; as=style`),
    `<${TURNSTILE}>; rel=preconnect`,
  ].join(", ");
}

/**
 * Wraps the router's render so an HTML page of any status leaves with its finished policy and `Link` header, built
 * from the page's own inline hashes (F26 d): a not-found page carries the router's inline scripts too (H1). The cache
 * module stores both with the page, so a hit does no hashing. If hashing fails the page goes out without them and the
 * pipeline's default policy applies; the error goes to Sentry.
 */
export function withPageCsp(render: Render, env: string, flags: Flags, framing: Framing): Render {
  return async (request, requestId) => {
    const response = await render(request, requestId);
    if (
      response.body === null ||
      !(response.headers.get("content-type") ?? "").toLowerCase().startsWith("text/html")
    ) {
      return response;
    }
    const html = await response.text();
    const headers = new Headers(response.headers);
    const report = (error: Error) =>
      waitUntilOf(request)(
        captureException(error, {
          requestId,
          route: new URL(request.url).pathname,
          ...sentryOptions(),
        }),
      );
    try {
      const found = await inlineHashes(html);
      headers.delete("content-security-policy");
      headers.delete("content-security-policy-report-only");
      headers.set(policyHeaderName(flags), cspFor(env, flags, found, { framing }));
      headers.set("link", pageLinks(html));
      if (found.unexpected > 0) report(new Error("csp_unexpected_inline_script"));
    } catch (error) {
      report(error instanceof Error ? error : new Error("csp_hashing_failed"));
    }
    return new Response(html, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };
}
