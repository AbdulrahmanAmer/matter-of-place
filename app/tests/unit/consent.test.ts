// @vitest-environment jsdom
// The analytics choice (GP-02): one localStorage record, read in one place. A record for another version, a browser
// that sends Global Privacy Control and any storage failure all mean "no". Nothing here may throw.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CONSENT_VERSION,
  consentGranted,
  onConsentChange,
  onConsentNoticeOpen,
  openConsentNotice,
  readConsent,
  writeConsent,
} from "../../src/lib/consent";

const KEY = "mop_consent";

function sendGlobalPrivacyControl() {
  Object.defineProperty(navigator, "globalPrivacyControl", { value: true, configurable: true });
}

beforeEach(() => {
  localStorage.clear();
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
    expect(new Date(readConsent()?.decided_at ?? "").toISOString()).toBe(readConsent()?.decided_at);
    expect(consentGranted()).toBe(true);
  });

  it("stores a decline as analytics false", () => {
    writeConsent(false);
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
