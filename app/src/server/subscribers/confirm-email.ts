import { aesGcmOpen, aesGcmSeal, fromBase64, fromBase64Url, toBase64Url } from "../lib/crypto.ts";

// The confirm token sealed for the event that mails the link (B5 invariant 7). The caller passes the key, the base64
// `CONFIRM_TOKEN_SECRET`, so this module reads no environment and runs in the Worker and the job runner alike.

const keyBytes = (key: string): Uint8Array => fromBase64(key);

/** The raw token sealed with AES-GCM, as base64url. */
export async function sealToken(raw: string, key: string): Promise<string> {
  return toBase64Url(await aesGcmSeal(keyBytes(key), new TextEncoder().encode(raw)));
}

/** The raw token, or null when the text was changed, is not base64url, or was sealed with another key. */
export async function openToken(sealed: string, key: string): Promise<string | null> {
  let bytes: Uint8Array;
  try {
    bytes = fromBase64Url(sealed);
  } catch {
    return null;
  }
  const opened = await aesGcmOpen(keyBytes(key), bytes);
  return opened === null ? null : new TextDecoder().decode(opened);
}
