import { z } from "zod";

// The visitor's analytics choice (GP-02, architecture 10): client side only, one `localStorage` record, and this
// file is its single reader (F11). Storage that is off, blocked or corrupt reads as "no decision" and never throws.
// Google Analytics loads only while `consentGranted()` holds; first-party `track()` events are exempt.

/** Raised to ask every visitor again. */
export const CONSENT_VERSION = 1;

const KEY = "mop_consent";
const OPEN_EVENT = "mop:consent-open";

const recordSchema = z.object({
  version: z.number(),
  analytics: z.boolean(),
  decided_at: z.string().optional(),
});
export type ConsentRecord = z.infer<typeof recordSchema>;

const listeners = new Set<() => void>();

export function readConsent(): ConsentRecord | undefined {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return undefined;
    const parsed = recordSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/** Stores the choice for the current version and tells the listeners; false when the storage refused it. */
export function writeConsent(analytics: boolean): boolean {
  try {
    const record: ConsentRecord = {
      version: CONSENT_VERSION,
      analytics,
      decided_at: new Date().toISOString(),
    };
    localStorage.setItem(KEY, JSON.stringify(record));
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
