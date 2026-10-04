// The beacon half of `track()` (architecture 13 rule 8, G45): events queue, leave at most 20 to a beacon, every
// 10 seconds and when the page is hidden. The dataLayer half is analytics.test.ts. The module keeps its queue in
// module state, so every test loads a fresh copy under fake timers and a stubbed browser.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { AnalyticsEvent } from "../../src/lib/analytics";

const beaconBody = z.array(
  z.object({ event: z.string(), data: z.record(z.string(), z.unknown()) }),
);

class FakeBlob {
  constructor(
    readonly parts: string[],
    readonly options: { type: string },
  ) {}
}

interface Sent {
  url: string;
  type: string;
  events: z.infer<typeof beaconBody>;
}

const LANDING = "?utm_source=instagram&utm_medium=social&utm_campaign=s";

function stubBrowser(search = "", storageThrows = false) {
  const stored = new Map<string, string>();
  const handlers: Record<string, (() => void)[]> = {};
  const document = {
    visibilityState: "visible",
    addEventListener: (type: string, handler: () => void) => {
      (handlers[type] ??= []).push(handler);
    },
  };
  const sent: Sent[] = [];
  vi.stubGlobal("Blob", FakeBlob);
  vi.stubGlobal("document", document);
  vi.stubGlobal("navigator", {
    sendBeacon: (url: string, body: FakeBlob) => {
      sent.push({
        url,
        type: body.options.type,
        events: beaconBody.parse(JSON.parse(body.parts.join(""))),
      });
      return true;
    },
  });
  vi.stubGlobal("window", { location: { pathname: "/california", search }, dataLayer: [] });
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => {
      if (storageThrows) throw new Error("storage is off");
      return stored.get(key) ?? null;
    },
    setItem: (key: string, value: string) => {
      if (storageThrows) throw new Error("storage is off");
      stored.set(key, value);
    },
  });
  return {
    sent,
    stored,
    dataLayer: () => (window.dataLayer ??= []),
    setPath: (pathname: string, nextSearch: string) => {
      vi.stubGlobal("window", {
        location: { pathname, search: nextSearch },
        dataLayer: window.dataLayer,
      });
    },
    hide: () => {
      document.visibilityState = "hidden";
      for (const handler of handlers["visibilitychange"] ?? []) handler();
    },
  };
}

async function load() {
  vi.resetModules();
  return import("../../src/lib/analytics");
}

const event: AnalyticsEvent = "property_view";

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("VITE_API_BASE_URL", "/api/public");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("track() batching", () => {
  it("sends 25 events made in a second as one beacon of 20 at the 10 second flush and one of 5 after it", async () => {
    const browser = stubBrowser();
    const { track } = await load();
    for (let n = 0; n < 25; n += 1) track(event, { n });
    vi.advanceTimersByTime(1000);
    expect(browser.sent).toHaveLength(0);
    vi.advanceTimersByTime(9000);
    expect(browser.sent.map((beacon) => beacon.events.length)).toEqual([20, 5]);
    expect(browser.sent.map((beacon) => beacon.events.map((entry) => entry.data["n"]))).toEqual([
      Array.from({ length: 20 }, (_, n) => n),
      [20, 21, 22, 23, 24],
    ]);
    expect(browser.sent[0]).toMatchObject({ url: "/api/public/events", type: "application/json" });
    vi.advanceTimersByTime(30_000);
    expect(browser.sent).toHaveLength(2);
  });

  it("flushes at once when the page becomes hidden, and not when it stays visible", async () => {
    const browser = stubBrowser();
    const { track } = await load();
    track(event);
    track("share");
    expect(browser.sent).toHaveLength(0);
    browser.hide();
    expect(browser.sent.map((beacon) => beacon.events.map((entry) => entry.event))).toEqual([
      ["property_view", "share"],
    ]);
    vi.advanceTimersByTime(20_000);
    expect(browser.sent).toHaveLength(1);
  });

  it("sends nothing for an empty queue", async () => {
    const browser = stubBrowser();
    const { track } = await load();
    track(event);
    browser.hide();
    browser.hide();
    vi.advanceTimersByTime(60_000);
    expect(browser.sent).toHaveLength(1);
  });

  it("sends nothing at all before the first event", async () => {
    const browser = stubBrowser();
    await load();
    browser.hide();
    vi.advanceTimersByTime(60_000);
    expect(browser.sent).toHaveLength(0);
  });

  it("pushes every event to dataLayer at once, before any beacon", async () => {
    const browser = stubBrowser();
    const { track } = await load();
    for (let n = 0; n < 25; n += 1) track(event, { n });
    expect(browser.dataLayer()).toHaveLength(25);
    expect(browser.sent).toHaveLength(0);
  });

  it("queues nothing when no API base URL is configured, and still fills dataLayer", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "");
    const browser = stubBrowser();
    const { track } = await load();
    track(event);
    browser.hide();
    vi.advanceTimersByTime(60_000);
    expect(browser.sent).toHaveLength(0);
    expect(browser.dataLayer()).toHaveLength(1);
  });
});

describe("track() campaign attribution (G45)", () => {
  const utm = { utm_source: "instagram", utm_medium: "social", utm_campaign: "s" };

  it("adds the landing page's data.utm to every envelope of the session, also after a page without parameters", async () => {
    const browser = stubBrowser(LANDING);
    const first = await load();
    first.setUtmConsent(() => true);
    first.track(event);
    browser.setPath("/stories", "");
    first.track("story_view", { slug: "a" });
    expect(browser.stored.get("mop_utm")).toBe(JSON.stringify(utm));
    // A full page load on another page of the same session: the module starts again, the storage stays.
    const second = await load();
    second.setUtmConsent(() => true);
    second.track("market_view");
    browser.hide();
    expect(
      browser.sent.flatMap((beacon) => beacon.events.map((entry) => entry.data["utm"])),
    ).toEqual([utm, utm, utm]);
    expect(browser.sent[0]?.events[1]?.data).toEqual({ slug: "a", utm });
  });

  it("omits a missing parameter and cuts a long one to 100 characters", async () => {
    const browser = stubBrowser(`?utm_source=${"x".repeat(150)}&utm_campaign=`);
    const { track, setUtmConsent } = await load();
    setUtmConsent(() => true);
    track(event);
    browser.hide();
    expect(browser.sent[0]?.events[0]?.data["utm"]).toEqual({ utm_source: "x".repeat(100) });
  });

  it("adds no utm and stores no mop_utm while the default predicate holds", async () => {
    const browser = stubBrowser(LANDING);
    const { track } = await load();
    track(event);
    browser.hide();
    expect(browser.sent[0]?.events[0]?.data).toEqual({});
    expect(browser.stored.has("mop_utm")).toBe(false);
  });

  it("utm consent follows the stored record and Global Privacy Control", async () => {
    const browser = stubBrowser(LANDING);
    const consent = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => consent.get(key) ?? null,
      setItem: (key: string, value: string) => {
        consent.set(key, value);
      },
    });
    const first = await load();
    const { writeConsent } = await import("../../src/lib/consent");
    // The wiring in analytics.ts is what runs: this case never calls setUtmConsent.
    first.track(event);
    browser.hide();
    expect(browser.sent[0]?.events[0]?.data).toEqual({});
    expect(browser.stored.has("mop_utm")).toBe(false);
    writeConsent(true);
    first.track("share");
    browser.hide();
    expect(browser.sent[1]?.events[0]?.data).toEqual({ utm });
    // The same granting record, from a browser that sends Global Privacy Control.
    browser.stored.clear();
    Object.defineProperty(navigator, "globalPrivacyControl", { value: true });
    const second = await load();
    second.track(event);
    browser.hide();
    expect(browser.sent).toHaveLength(3);
    expect(browser.sent[2]?.events[0]?.data).toEqual({});
    expect(browser.stored.has("mop_utm")).toBe(false);
  });

  it("adds no utm and never throws when the storage fails", async () => {
    const browser = stubBrowser(LANDING, true);
    const { track, setUtmConsent } = await load();
    setUtmConsent(() => true);
    expect(() => {
      track(event);
    }).not.toThrow();
    browser.hide();
    expect(browser.sent[0]?.events[0]?.data).toEqual({});
  });

  it("ignores a stored value that is not the three parameters", async () => {
    const browser = stubBrowser(LANDING);
    browser.stored.set("mop_utm", '{"utm_source":1}');
    const { track, setUtmConsent } = await load();
    setUtmConsent(() => true);
    track(event);
    browser.hide();
    expect(browser.sent[0]?.events[0]?.data).toEqual({});
  });
});
