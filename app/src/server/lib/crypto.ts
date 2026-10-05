// The one Web Crypto module (CS-04). The job runner loads it under Deno, so it imports nothing
// and reads no environment.

const encoder = new TextEncoder();

const bytesOf = (input: string | Uint8Array): Uint8Array<ArrayBuffer> =>
  typeof input === "string" ? encoder.encode(input) : new Uint8Array(input);

export async function hmacSha256(
  key: string | Uint8Array,
  message: string | Uint8Array,
): Promise<Uint8Array> {
  const hmacKey = await crypto.subtle.importKey(
    "raw",
    bytesOf(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", hmacKey, bytesOf(message)));
}

/**
 * Compares every byte whatever the first difference. Plain code on purpose:
 * `crypto.subtle.timingSafeEqual` exists only on Workers, not in Node, Bun or Deno.
 */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return difference === 0;
}

/** @public */
// STUB(B8): first used by src/server/lib/hmac.ts (signBody, verifyBody)
export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  return toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytesOf(input))));
}

/** @public */
export async function sha1Bytes(input: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-1", bytesOf(input)));
}

export function fromBase64(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
}

export function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function randomToken(bytes = 32): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

const IV_BYTES = 12;

const aesKey = (key: Uint8Array, usage: "encrypt" | "decrypt") =>
  crypto.subtle.importKey("raw", bytesOf(key), "AES-GCM", false, [usage]);

/** @public A fresh 12-byte IV followed by the ciphertext and its tag. */
// STUB(B5): first used by src/server/subscribers/confirm-email.ts (sealed confirm token)
export async function aesGcmSeal(key: Uint8Array, plaintext: Uint8Array): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      await aesKey(key, "encrypt"),
      bytesOf(plaintext),
    ),
  );
  const out = new Uint8Array(IV_BYTES + sealed.length);
  out.set(iv);
  out.set(sealed, IV_BYTES);
  return out;
}

/** @public Null when the data was changed or sealed with another key. */
// STUB(B5): first used by src/server/subscribers/confirm-email.ts (sealed confirm token)
export async function aesGcmOpen(key: Uint8Array, sealed: Uint8Array): Promise<Uint8Array | null> {
  const cryptoKey = await aesKey(key, "decrypt");
  try {
    return new Uint8Array(
      await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: bytesOf(sealed.subarray(0, IV_BYTES)) },
        cryptoKey,
        bytesOf(sealed.subarray(IV_BYTES)),
      ),
    );
  } catch {
    return null;
  }
}
