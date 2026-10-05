import type { Actor } from "./actor.ts";
import { hmacSha256, timingSafeEqual, toBase64Url } from "./crypto.ts";
import { AppError } from "./errors.ts";

// The signed double-submit token of invariant 11 (API-05). It is an HMAC of the verified token's
// `session_id`, so it survives a token refresh and a browser restart, and a value made for one session
// is worthless in another. The cookie only carries it to the page; the check recomputes it.

export const CSRF_COOKIE = "mop_csrf";
const CSRF_HEADER = "x-mop-csrf";
const COOKIE_ATTRIBUTES = "Path=/; Secure; SameSite=Lax";
const COOKIE_SECONDS = 43_200;

const encoder = new TextEncoder();

const refused = () => new AppError("csrf", undefined, "Please reload the page and try again.");

export async function csrfTokenFor(sessionId: string, key: string): Promise<string> {
  return toBase64Url(await hmacSha256(key, sessionId));
}

/** Readable by the page script, which echoes it in `X-MOP-CSRF`. */
export function csrfCookie(token: string): string {
  return `${CSRF_COOKIE}=${token}; ${COOKIE_ATTRIBUTES}; Max-Age=${String(COOKIE_SECONDS)}`;
}

export function expireCsrfCookie(): string {
  return `${CSRF_COOKIE}=; ${COOKIE_ATTRIBUTES}; Max-Age=0`;
}

/** False only when an `Origin` header is present and names another origin than the request's own. */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return origin === null || origin === new URL(request.url).origin;
}

/**
 * A session write must come from this origin and carry the token of its own session. A bearer key carries
 * no cookie, so it is exempt. With no key configured every session write answers 503.
 */
export async function verifyCsrf(
  request: Request,
  actor: Actor,
  key: string | undefined,
): Promise<void> {
  if (actor.session === undefined) return;
  if (key === undefined) {
    throw new AppError(
      "csrf_secret_missing",
      undefined,
      "Saving is unavailable at the moment. Please try again later.",
    );
  }
  if (!sameOrigin(request)) throw refused();
  const sent = request.headers.get(CSRF_HEADER);
  if (sent === null) throw refused();
  const expected = await csrfTokenFor(actor.session.id, key);
  if (!timingSafeEqual(encoder.encode(sent), encoder.encode(expected))) throw refused();
}

// A scheme (`https:`, `javascript:`), a protocol-relative `//`, a backslash, or any character outside
// printable ASCII: a browser drops tabs and line breaks from a URL, which could join two slashes.
const UNSAFE = /\/\/|\\|:|[^\x20-\x7e]/;
const UNDER_ADMIN = /^\/admin(?:[/?#]|$)/;

/** Where a sign-in may send the browser: a path under `/admin`, else `/admin`. */
export function safeNext(next: string | null | undefined): string {
  if (next === null || next === undefined || UNSAFE.test(next)) return "/admin";
  return UNDER_ADMIN.test(next) ? next : "/admin";
}
