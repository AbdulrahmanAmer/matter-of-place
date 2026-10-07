// @vitest-environment jsdom
// The analytics choice (GP-02): one localStorage record, read in one place. A record for another version, a browser
// that sends Global Privacy Control and any storage failure all mean "no". Nothing here may throw.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { createElement, Fragment } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ConsentNotice } from "../../src/components/layout/consent-notice";
import { Ga4Loader } from "../../src/components/site/ga4-loader";
import { track } from "../../src/lib/analytics";
import { loadGa4 } from "../../src/lib/ga4";
import {
  CONSENT_VERSION,
  consentGranted,
  onConsentChange,
  onConsentNoticeOpen,
  openConsentNotice,
  readConsent,
  writeConsent,
} from "../../src/lib/consent";

vi.mock("../../src/lib/analytics", () => ({ track: vi.fn() }));

const KEY = "mop_consent";
const MEASUREMENT_ID = "G-TEST000000";
const GTAG = 'script[src^="https://www.googletagmanager.com/gtag/js"]';

function sendGlobalPrivacyControl() {
  Object.defineProperty(navigator, "globalPrivacyControl", { value: true, configurable: true });
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.mocked(track).mockClear();
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(navigator, "globalPrivacyControl");
  Reflect.deleteProperty(window, "dataLayer");
  document.head.querySelectorAll(GTAG).forEach((script) => {
    script.remove();
  });
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
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

function grant() {
  localStorage.setItem(KEY, JSON.stringify({ version: CONSENT_VERSION, analytics: true }));
}

const argumentsLike = z.custom<ArrayLike<unknown>>(
  (value) => typeof value === "object" && value !== null && "length" in value,
);

/** What gtag pushed to the dataLayer, one array per command. */
function pushedCommands(): unknown[][] {
  return (window.dataLayer ?? []).map((entry) => Array.from(argumentsLike.parse(entry)));
}

describe("loadGa4", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("injects one script on the first call and none on the second", () => {
    grant();
    loadGa4(MEASUREMENT_ID);
    loadGa4(MEASUREMENT_ID);
    vi.runAllTimers();
    loadGa4(MEASUREMENT_ID);
    vi.runAllTimers();
    const scripts = document.querySelectorAll<HTMLScriptElement>(GTAG);
    expect(scripts).toHaveLength(1);
    expect(scripts[0]?.src).toBe(`https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`);
  });

  it("waits for idle: nothing is in the page before the browser is idle", () => {
    grant();
    loadGa4(MEASUREMENT_ID);
    expect(document.querySelector(GTAG)).toBeNull();
    vi.runAllTimers();
    expect(document.querySelector(GTAG)).not.toBeNull();
  });

  it("injects nothing without consent, for a stale version or with Global Privacy Control", () => {
    const refused = [
      () => undefined,
      () => localStorage.setItem(KEY, JSON.stringify({ version: 0, analytics: true })),
      () => {
        grant();
        sendGlobalPrivacyControl();
      },
    ];
    for (const setUp of refused) {
      localStorage.clear();
      Reflect.deleteProperty(navigator, "globalPrivacyControl");
      setUp();
      loadGa4(MEASUREMENT_ID);
      vi.runAllTimers();
      expect(document.querySelector(GTAG)).toBeNull();
    }
    expect(window.dataLayer).toBeUndefined();
  });

  it("injects nothing with no measurement id", () => {
    grant();
    loadGa4("");
    vi.runAllTimers();
    expect(document.querySelector(GTAG)).toBeNull();
  });

  it("injects nothing when the choice is withdrawn before the idle moment", () => {
    grant();
    loadGa4(MEASUREMENT_ID);
    writeConsent(false);
    vi.runAllTimers();
    expect(document.querySelector(GTAG)).toBeNull();
  });

  it("makes the first config entry switch Google signals and ad personalization off", () => {
    grant();
    loadGa4(MEASUREMENT_ID);
    vi.runAllTimers();
    const commands = pushedCommands();
    expect(commands.map((command) => command[0])).toEqual(["js", "config"]);
    expect(commands.find((command) => command[0] === "config")).toEqual([
      "config",
      MEASUREMENT_ID,
      { allow_google_signals: false, allow_ad_personalization_signals: false },
    ]);
  });
});

describe("Ga4Loader", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_GA4_MEASUREMENT_ID", MEASUREMENT_ID);
  });

  it("loads the script after a later Allow and not before it", () => {
    vi.useFakeTimers();
    render(createElement(Ga4Loader));
    vi.runAllTimers();
    expect(document.querySelector(GTAG)).toBeNull();
    writeConsent(true);
    vi.runAllTimers();
    expect(document.querySelectorAll(GTAG)).toHaveLength(1);
  });

  it("loads the script for a grant stored by an earlier visit", () => {
    vi.useFakeTimers();
    grant();
    render(createElement(Ga4Loader));
    vi.runAllTimers();
    expect(document.querySelectorAll(GTAG)).toHaveLength(1);
  });

  it("does nothing without a measurement id", () => {
    vi.stubEnv("VITE_GA4_MEASUREMENT_ID", "");
    vi.useFakeTimers();
    grant();
    sendGlobalPrivacyControl();
    render(createElement(Ga4Loader));
    vi.runAllTimers();
    expect(document.querySelector(GTAG)).toBeNull();
    expect(track).not.toHaveBeenCalled();
  });

  it("tracks consent_set via gpc once per session when Global Privacy Control overrides a grant", () => {
    grant();
    sendGlobalPrivacyControl();
    const first = render(createElement(Ga4Loader));
    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith("consent_set", { analytics: false, via: "gpc" });
    expect(sessionStorage.getItem("mop_consent_gpc_tracked")).not.toBeNull();
    first.unmount();
    render(createElement(Ga4Loader));
    expect(track).toHaveBeenCalledTimes(1);
  });

  it("tracks nothing when Global Privacy Control overrides no grant, or a grant is not overridden", () => {
    sendGlobalPrivacyControl();
    localStorage.setItem(KEY, JSON.stringify({ version: CONSENT_VERSION, analytics: false }));
    const declined = render(createElement(Ga4Loader));
    declined.unmount();
    Reflect.deleteProperty(navigator, "globalPrivacyControl");
    grant();
    render(createElement(Ga4Loader));
    expect(track).not.toHaveBeenCalled();
  });

  it("leaves a click on the notice to the notice: one consent_set, and none from the loader", async () => {
    sendGlobalPrivacyControl();
    const router = createRouter({
      routeTree: createRootRoute({
        component: () =>
          createElement(Fragment, null, createElement(ConsentNotice), createElement(Ga4Loader)),
      }),
      history: createMemoryHistory(),
    });
    render(createElement(RouterProvider, { router }));
    fireEvent.click(await screen.findByRole("button", { name: "Allow" }));
    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith("consent_set", { analytics: true });
  });
});
