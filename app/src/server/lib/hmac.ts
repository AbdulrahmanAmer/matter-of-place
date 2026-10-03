import { hmacSha256, timingSafeEqual, toHex } from "./crypto.ts";

// The render callback signature (B8 Contract): `sha256=<hex HMAC-SHA256 of "<timestamp>.<raw body>">`,
// keyed by RENDER_CALLBACK_SECRET. The timestamp window is the hook's rule, not this file's.

const encoder = new TextEncoder();

export async function signBody(
  secret: string,
  timestamp: string,
  rawBody: string,
): Promise<string> {
  return `sha256=${toHex(await hmacSha256(secret, `${timestamp}.${rawBody}`))}`;
}

export async function verifyBody(
  secret: string,
  timestamp: string,
  rawBody: string,
  signature: string,
): Promise<boolean> {
  const expected = await signBody(secret, timestamp, rawBody);
  return timingSafeEqual(encoder.encode(expected), encoder.encode(signature));
}
