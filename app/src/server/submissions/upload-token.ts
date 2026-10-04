import { hmacSha256, timingSafeEqual, toBase64Url } from "../lib/crypto";
import { env } from "../lib/env";

// The grant that ties `POST /submissions/:id/uploads` to a submission that passed Turnstile (E2E-02):
// `<exp>.<sig>`, `exp` a Unix second, `sig` the HMAC of `upload:<id>:<exp>` keyed by RATE_LIMIT_SALT. The
// `upload:` label keeps it apart from the rate-limit hashes made with the same key.

const LIFETIME_SECONDS = 2 * 60 * 60;
const TOKEN = /^(\d{1,12})\.([A-Za-z0-9_-]{1,100})$/;
const encoder = new TextEncoder();

async function signature(submissionId: string, exp: number): Promise<string> {
  return toBase64Url(
    await hmacSha256(env.RATE_LIMIT_SALT, `upload:${submissionId}:${String(exp)}`),
  );
}

export async function uploadToken(submissionId: string, now = Date.now()): Promise<string> {
  const exp = Math.floor(now / 1000) + LIFETIME_SECONDS;
  return `${String(exp)}.${await signature(submissionId, exp)}`;
}

/** False for another submission's token, an altered signature or an `exp` that has passed. */
export async function verifyUploadToken(
  submissionId: string,
  token: string,
  now = Date.now(),
): Promise<boolean> {
  const [, expText, given] = TOKEN.exec(token) ?? [];
  if (expText === undefined || given === undefined) return false;
  const exp = Number(expText);
  if (exp * 1000 < now) return false;
  const expected = await signature(submissionId, exp);
  return timingSafeEqual(encoder.encode(expected), encoder.encode(given));
}
