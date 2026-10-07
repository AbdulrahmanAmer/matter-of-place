import { fromBase64Url, hmacSha256, timingSafeEqual, toBase64Url } from "./crypto.ts";
import { AppError } from "./errors.ts";

// Draft preview links (B7 invariant 14, B2's format): `<property_id>.<exp>.<hmac>`, the HMAC-SHA256 of
// `<property_id>.<exp>.<preview_nonce>` under PREVIEW_TOKEN_SECRET. Rotating the property's nonce voids every link of
// that property. Each function takes the key its caller read from `env.ts`; unset, nothing verifies and nothing signs.

const LIFETIME_SECONDS = { editor: 15 * 60, agent: 7 * 24 * 60 * 60 } as const;
const TOKEN =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(\d{1,12})\.([\w-]{43})$/;

export type PreviewKind = keyof typeof LIFETIME_SECONDS;

const signed = async (key: string, propertyId: string, exp: string, nonce: string) =>
  hmacSha256(key, `${propertyId}.${exp}.${nonce}`);

/** A token for `propertyId`, valid 15 minutes for the editor's iframe and 7 days for an agent's link. */
export async function signPreview(
  key: string | undefined,
  propertyId: string,
  nonce: string,
  kind: PreviewKind,
): Promise<{ token: string; expiresAt: Date }> {
  if (key === undefined) {
    throw new AppError("preview_secret_missing", undefined, "Preview links are not set up here.");
  }
  const exp = Math.floor(Date.now() / 1000) + LIFETIME_SECONDS[kind];
  const mac = toBase64Url(await signed(key, propertyId, String(exp), nonce));
  return { token: `${propertyId}.${String(exp)}.${mac}`, expiresAt: new Date(exp * 1000) };
}

/** The property id of a well formed, unexpired token, or null. Reads no database, so it cannot verify the HMAC. */
export function checkPreviewSignature(
  key: string | undefined,
  token: string,
  now: Date,
): string | null {
  const [, propertyId, exp] = TOKEN.exec(token) ?? [];
  if (key === undefined || propertyId === undefined || exp === undefined) return null;
  return Number(exp) * 1000 > now.getTime() ? propertyId : null;
}

/** Recomputes the HMAC with the property's stored nonce and compares in constant time. */
export async function verifyPreview(
  key: string | undefined,
  token: string,
  nonce: string,
): Promise<boolean> {
  const [, propertyId, exp, mac] = TOKEN.exec(token) ?? [];
  if (key === undefined || propertyId === undefined || exp === undefined || mac === undefined) {
    return false;
  }
  return timingSafeEqual(fromBase64Url(mac), await signed(key, propertyId, exp, nonce));
}
