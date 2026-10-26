import { fromBase64Url, hmacSha256, timingSafeEqual, toBase64Url, toHex } from "../lib/crypto.ts";

// The one-click unsubscribe address of a bulk email sent to one reader (OPS-005, RFC 8058). Resend fills its own
// unsubscribe page only in a broadcast, so a one-to-one bulk mail carries this signed address in `List-Unsubscribe`:
// the reader's address and an HMAC of it under `CONFIRM_TOKEN_SECRET`, so no address can be unsubscribed by guessing.
// It reads no environment: the caller passes the key, so the Worker and the job runner share it.

const ORIGIN = "https://matterofplace.com";
const UNSUBSCRIBE_PATH = "/api/public/subscribers/unsubscribe";

const encoder = new TextEncoder();

const signature = async (key: string, address: string): Promise<string> =>
  toHex(await hmacSha256(key, `unsubscribe:${address}`));

/** The address that unsubscribes `address` (and no other) when it is posted to. */
export async function unsubscribeUrl(address: string, key: string): Promise<string> {
  const lower = address.toLowerCase();
  const token = `${toBase64Url(encoder.encode(lower))}.${await signature(key, lower)}`;
  return `${ORIGIN}${UNSUBSCRIBE_PATH}?t=${token}`;
}

/** The reader's address when `token` was made by `unsubscribeUrl` under `key`, else null. */
export async function openUnsubscribeToken(token: string, key: string): Promise<string | null> {
  const [encoded, given, ...extra] = token.split(".");
  if (encoded === undefined || given === undefined || extra.length > 0) return null;
  let address: string;
  try {
    address = new TextDecoder().decode(fromBase64Url(encoded));
  } catch {
    return null;
  }
  const expected = await signature(key, address);
  return timingSafeEqual(encoder.encode(expected), encoder.encode(given)) ? address : null;
}
