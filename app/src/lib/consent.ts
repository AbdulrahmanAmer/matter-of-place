import { z } from "zod";

// The visitor's analytics choice (GP-02, architecture 10): a `localStorage` record and the `mop_consent` cookie, and
// this file is the single reader (F11). Every writer sets the cookie, the link to `/api/consent` sets nothing else, so
// `readConsent()` reads the cookie first: the latest choice wins, with or without JavaScript, and the record answers
// only when no cookie does. Storage that is off, blocked or corrupt reads as "no decision" and never throws.
// Google Analytics loads only while `consentGranted()` holds; first-party `track()` events are exempt.

/** Raised to ask every visitor again. */
export const CONSENT_VERSION = 1;

/** SHA-256 of `JSON.stringify(cookieInventory)`: the `consent-version` test fails when the inventory moves and this does not. */
export const COOKIE_INVENTORY_HASH =
  "f4f5ebf84869afd5c19a3abcf3a2b709bf4f3880c044ec678573b5ca51fec43c";

const KEY = "mop_consent";
const OPEN_EVENT = "mop:consent-open";
const COOKIE_PATTERN = /(?:^|; )mop_consent=(\d+)\.([01])(?:;|$)/;
const COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

const recordSchema = z.object({
  version: z.number(),
  analytics: z.boolean(),
  decided_at: z.string().optional(),
});
export type ConsentRecord = z.infer<typeof recordSchema>;

const listeners = new Set<() => void>();

function readRecord(): ConsentRecord | undefined {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return undefined;
    const parsed = recordSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

function readCookie(): ConsentRecord | undefined {
  try {
    const match = COOKIE_PATTERN.exec(document.cookie);
    return match === null ? undefined : { version: Number(match[1]), analytics: match[2] === "1" };
  } catch {
    return undefined;
  }
}

/** The cookie, which every writer sets and a choice made without JavaScript sets alone; else the stored record. */
export function readConsent(): ConsentRecord | undefined {
  return readCookie() ?? readRecord();
}

/** The `Set-Cookie` value of a choice for the current version; the one writer of its attributes, browser and server. */
export function consentCookie(analytics: boolean): string {
  return `${KEY}=${String(CONSENT_VERSION)}.${analytics ? "1" : "0"}; Path=/; Max-Age=${String(COOKIE_MAX_AGE_SECONDS)}; SameSite=Lax; Secure`;
}

/** Stores the choice in both places for the current version and tells the listeners; false when the storage refused it. */
export function writeConsent(analytics: boolean): boolean {
  try {
    const record: ConsentRecord = {
      version: CONSENT_VERSION,
      analytics,
      decided_at: new Date().toISOString(),
    };
    localStorage.setItem(KEY, JSON.stringify(record));
    document.cookie = consentCookie(analytics);
  } catch {
    return false;
  }
  for (const listener of listeners) listener();
  return true;
}

function globalPrivacyControl(): boolean {
  return (
    typeof navigator !== "undefined" &&
    "globalPrivacyControl" in navigator &&
    navigator.globalPrivacyControl === true
  );
}

/** A record for the current version that says yes, from a browser that does not send Global Privacy Control. */
export function consentGranted(): boolean {
  const record = readConsent();
  return (
    record !== undefined &&
    record.version === CONSENT_VERSION &&
    record.analytics &&
    !globalPrivacyControl()
  );
}

/** Calls `callback` after each stored choice; returns the function that stops it. */
export function onConsentChange(callback: () => void): () => void {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

/** Asks the notice to show again (the footer's cookie settings control). Does nothing on the server. */
export function openConsentNotice(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(OPEN_EVENT));
}

export function onConsentNoticeOpen(callback: () => void): () => void {
  window.addEventListener(OPEN_EVENT, callback);
  return () => {
    window.removeEventListener(OPEN_EVENT, callback);
  };
}
