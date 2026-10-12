import { sha1Bytes, toHex } from "./crypto.ts";

// Gap audit item 12 (2026-10-12): Supabase's leaked-password protection is a paid setting, so a new password is
// checked here against Have I Been Pwned's range API. Only the first five characters of the password's SHA-1 leave
// the Worker (k-anonymity); `Add-Padding` hides the size of the answer. An outage never blocks the person: the check
// passes and logs nothing that names the password.

const RANGE = "https://api.pwnedpasswords.com/range/";
const TIMEOUT_MS = 2000;

/** True when the password is in a known breach; false when it is not, or when the service cannot answer. */
export async function passwordWasPwned(password: string): Promise<boolean> {
  const hash = toHex(await sha1Bytes(new TextEncoder().encode(password))).toUpperCase();
  const prefix = hash.slice(0, 5);
  const suffix = hash.slice(5);
  let body: string;
  try {
    const response = await fetch(`${RANGE}${prefix}`, {
      headers: { "Add-Padding": "true", "User-Agent": "matterofplace.com admin" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return false;
    body = await response.text();
  } catch {
    return false;
  }
  return body.split("\n").some((line) => {
    const [candidate = "", count = "0"] = line.trim().split(":");
    return candidate === suffix && Number(count) > 0;
  });
}
