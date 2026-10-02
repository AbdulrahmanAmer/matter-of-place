import { timingSafeEqual } from "../lib/crypto";

class SentryTestError extends Error {
  override name = "SentryTestError";
}

const bytes = (text: string) => new TextEncoder().encode(text);

/**
 * Throws a marked error for the right bearer, so a test proves the whole path to Sentry. The
 * message carries an address on purpose: the stored event must show `[email]` instead.
 * Answers 404 whenever the token is unset, so production is inert outside a test.
 */
export function handleSentryTest(request: Request, token: string | undefined): Response {
  const bearer = /^Bearer (.+)$/.exec(request.headers.get("authorization") ?? "")?.[1];
  if (!token || bearer === undefined || !timingSafeEqual(bytes(bearer), bytes(token))) {
    return new Response(null, { status: 404 });
  }
  throw new SentryTestError("Sentry test error for test@example.com");
}
