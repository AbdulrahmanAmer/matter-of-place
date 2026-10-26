import { hmacSha256, timingSafeEqual, toHex } from "../lib/crypto.ts";

// The one-click unsubscribe address of a bulk email sent to one reader (OPS-005, RFC 8058). Resend fills its own
// unsubscribe page only in a broadcast, so a one-to-one bulk mail carries this signed address in `List-Unsubscribe`:
// the reader's subscriber id, never the email address (the query string reaches the Worker's logs), and an HMAC of it
// under `CONFIRM_TOKEN_SECRET` with its own purpose prefix, so no reader can be unsubscribed by guessing. Rotating that
// secret ends every link in mail already sent (docs/runbooks/rotation.md). It reads no environment: the caller passes
// the key and the origin, so the Worker and the job runner share it.

export const UNSUBSCRIBE_PATH = "/api/public/subscribers/unsubscribe";

const SUBSCRIBER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const encoder = new TextEncoder();

const signature = async (key: string, id: string): Promise<string> =>
  toHex(await hmacSha256(key, `unsubscribe:${id}`));

/** The address on `origin` (the site's `SITE_URL`) that unsubscribes subscriber `id`, and no other, when it is posted to. */
export async function unsubscribeUrl(id: string, key: string, origin: string): Promise<string> {
  return `${origin.replace(/\/+$/, "")}${UNSUBSCRIBE_PATH}?t=${id}.${await signature(key, id)}`;
}

/** The subscriber id when `token` was made by `unsubscribeUrl` under `key`, else null. */
export async function openUnsubscribeToken(token: string, key: string): Promise<string | null> {
  const [id, given, ...extra] = token.split(".");
  if (id === undefined || given === undefined || extra.length > 0 || !SUBSCRIBER_ID.test(id)) {
    return null;
  }
  const expected = await signature(key, id);
  return timingSafeEqual(encoder.encode(expected), encoder.encode(given)) ? id : null;
}
