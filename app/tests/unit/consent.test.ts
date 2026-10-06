// @vitest-environment jsdom
// The analytics choice (GP-02): one localStorage record, read in one place. A record for another version, a browser
// that sends Global Privacy Control and any storage failure all mean "no". Nothing here may throw. A choice made
// without JavaScript is the `mop_consent` cookie, which `readConsent()` reads before the record, because every writer sets it and the latest choice must win.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  CONSENT_VERSION,
  consentCookie,
  consentGranted,
  onConsentChange,
  onConsentNoticeOpen,
  openConsentNotice,
  readConsent,
  writeConsent,
} from "../../src/lib/consent";

const KEY = "mop_consent";

/** What `writeConsent` left in `localStorage`, read without `readConsent()`, which reads the cookie first. */
function storedRecord() {
  return z
    .object({ version: z.number(), analytics: z.boolean(), decided_at: z.string() })
    .parse(JSON.parse(localStorage.getItem(KEY) ?? "{}"));
}

function sendGlobalPrivacyControl() {
  Object.defineProperty(navigator, "globalPrivacyControl", { value: true, configurable: true });
}

beforeEach(() => {
  localStorage.clear();
  document.cookie = `${KEY}=; Max-Age=0; Path=/`;
});

afterEach(() => {
  Reflect.deleteProperty(navigator, "globalPrivacyControl");
  vi.restoreAllMocks();
});

describe("consentGranted", () => {
  it("is false with no record and reads no decision", () => {
    expect(consentGranted()).toBe(false);
    expect(readConsent()).toBeUndefined();
  });

  it("is true for a record of the current version that says yes", () => {
    localStorage.setItem(KEY, JSON.stringify({ version: 1, analytics: true }));
    expect(CONSENT_VERSION).toBe(1);
    expect(consentGranted()).toBe(true);
  });

  it("is false for a record that says no", () => {
    localStorage.setItem(KEY, JSON.stringify({ version: 1, analytics: false }));
    expect(consentGranted()).toBe(false);
  });

  it("is false for a stale version, so a raised version asks again", () => {
    localStorage.setItem(KEY, JSON.stringify({ version: 0, analytics: true }));
    expect(consentGranted()).toBe(false);
  });

  it("is false when Global Privacy Control is set, even for a granting record", () => {
    localStorage.setItem(KEY, JSON.stringify({ version: 1, analytics: true }));
    sendGlobalPrivacyControl();
    expect(consentGranted()).toBe(false);
  });
});

describe("a record that cannot be read", () => {
  it("reads corrupt JSON and a record of the wrong shape as no decision", () => {
    localStorage.setItem(KEY, "{not json");
    expect(readConsent()).toBeUndefined();
    expect(consentGranted()).toBe(false);
    localStorage.setItem(KEY, JSON.stringify({ version: "1", analytics: "yes" }));
    expect(readConsent()).toBeUndefined();
    expect(consentGranted()).toBe(false);
  });

  it("reads a throwing localStorage as no decision and lets writeConsent report it", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage is off");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage is off");
    });
    expect(readConsent()).toBeUndefined();
    expect(consentGranted()).toBe(false);
    expect(writeConsent(true)).toBe(false);
  });
});

describe("writeConsent", () => {
  it("stores the current version, the choice and the time of the decision", () => {
    expect(writeConsent(true)).toBe(true);
    expect(readConsent()).toMatchObject({ version: CONSENT_VERSION, analytics: true });
    const stored = storedRecord();
    expect(stored).toMatchObject({ version: CONSENT_VERSION, analytics: true });
    expect(new Date(stored.decided_at).toISOString()).toBe(stored.decided_at);
    expect(consentGranted()).toBe(true);
  });

  it("stores a decline as analytics false", () => {
    writeConsent(false);
    expect(storedRecord()).toMatchObject({ version: CONSENT_VERSION, analytics: false });
    expect(readConsent()).toMatchObject({ version: CONSENT_VERSION, analytics: false });
    expect(consentGranted()).toBe(false);
  });

  it("tells a listener once per write, and not after it stops", () => {
    const listener = vi.fn();
    const stop = onConsentChange(listener);
    writeConsent(true);
    expect(listener).toHaveBeenCalledTimes(1);
    writeConsent(false);
    expect(listener).toHaveBeenCalledTimes(2);
    stop();
    writeConsent(true);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("tells no listener when the storage refused the write", () => {
    const listener = vi.fn();
    const stop = onConsentChange(listener);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage is off");
    });
    writeConsent(true);
    stop();
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("the notice event", () => {
  it("reaches a subscriber once per request and not after it unsubscribes", () => {
    const opened = vi.fn();
    const stop = onConsentNoticeOpen(opened);
    openConsentNotice();
    expect(opened).toHaveBeenCalledTimes(1);
    stop();
    openConsentNotice();
    expect(opened).toHaveBeenCalledTimes(1);
  });
});

describe("the mop_consent cookie", () => {
  const cookieWrites = () => {
    const written: string[] = [];
    vi.spyOn(document, "cookie", "set").mockImplementation((value) => {
      written.push(value);
    });
    return written;
  };

  it("writeConsent(false) sets mop_consent=1.0 with Path, Max-Age, SameSite and Secure", () => {
    const written = cookieWrites();
    expect(writeConsent(false)).toBe(true);
    expect(written).toEqual(["mop_consent=1.0; Path=/; Max-Age=31536000; SameSite=Lax; Secure"]);
  });

  it("writeConsent(true) sets mop_consent=1.1, the server's cookie for an accept", () => {
    const written = cookieWrites();
    writeConsent(true);
    expect(written).toEqual([consentCookie(true)]);
    expect(consentCookie(true)).toBe(
      "mop_consent=1.1; Path=/; Max-Age=31536000; SameSite=Lax; Secure",
    );
  });

  it("writes no cookie when the storage refused the record", () => {
    const written = cookieWrites();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage is off");
    });
    expect(writeConsent(true)).toBe(false);
    expect(written).toEqual([]);
  });

  it("readConsent returns the cookie's choice when localStorage is empty", () => {
    document.cookie = "mop_consent=1.1";
    expect(readConsent()).toEqual({ version: CONSENT_VERSION, analytics: true });
    expect(consentGranted()).toBe(true);
    document.cookie = "mop_consent=1.0";
    expect(readConsent()).toEqual({ version: CONSENT_VERSION, analytics: false });
    expect(consentGranted()).toBe(false);
  });

  it("readConsent prefers the cookie, so a decline made by a plain link beats an older Allow record", () => {
    writeConsent(true);
    document.cookie = "mop_consent=1.0";
    expect(readConsent()).toEqual({ version: CONSENT_VERSION, analytics: false });
    expect(consentGranted()).toBe(false);
    document.cookie = "mop_consent=1.1";
    localStorage.setItem(KEY, JSON.stringify({ version: 1, analytics: false }));
    expect(readConsent()).toEqual({ version: CONSENT_VERSION, analytics: true });
  });

  it("reads a malformed cookie as the record, and as no decision when there is none", () => {
    localStorage.setItem(KEY, JSON.stringify({ version: 1, analytics: false }));
    document.cookie = "mop_consent=1.2";
    expect(readConsent()).toMatchObject({ analytics: false });
    localStorage.clear();
    for (const value of ["1.2", "1", "x.1", "1.1.1", ""]) {
      document.cookie = `mop_consent=${value}`;
      expect(readConsent()).toBeUndefined();
    }
  });

  it("reads the cookie of an older version as that version, so a raised version asks again", () => {
    document.cookie = "mop_consent=0.1";
    expect(readConsent()).toEqual({ version: 0, analytics: true });
    expect(consentGranted()).toBe(false);
  });

  it("is not granted by a cookie that says yes while Global Privacy Control is set", () => {
    document.cookie = "mop_consent=1.1";
    expect(consentGranted()).toBe(true);
    sendGlobalPrivacyControl();
    expect(consentGranted()).toBe(false);
  });

  it("reads a throwing localStorage as the cookie, since the cookie needs no storage", () => {
    document.cookie = "mop_consent=1.1";
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage is off");
    });
    expect(readConsent()).toEqual({ version: CONSENT_VERSION, analytics: true });
  });
});
