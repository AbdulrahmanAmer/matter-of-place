// @vitest-environment jsdom
// B15 invariant 4: first-party, cookie-free attribution in `sessionStorage`, sent only inside a submitted inquiry.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { inquirySchema } from "../../../src/domain/contracts";
import type { FetchImpl } from "../../../src/services/http/client";
import { validInquiry } from "../../fixtures/builders";

const RECEIPT = { id: "r1", receivedAt: "2026-10-04T00:00:00Z" };

/** A fresh copy of the module, loaded on a page whose document came from `referrer`. */
async function page(referrer = "") {
  Object.defineProperty(document, "referrer", { value: referrer, configurable: true });
  vi.resetModules();
  return import("../../../src/lib/attribution");
}

const stored = (): unknown => JSON.parse(sessionStorage.getItem("mop_attribution") ?? "null");

const fetchSpy = vi.fn<FetchImpl>(() => Promise.resolve(Response.json(RECEIPT, { status: 201 })));

/** Whether any request the spy saw carried an `attribution` field. */
const carried = () =>
  fetchSpy.mock.calls.some(
    ([, init]) => typeof init.body === "string" && init.body.includes("attribution"),
  );

beforeEach(() => {
  sessionStorage.clear();
  fetchSpy.mockClear();
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("captureAttribution", () => {
  it("captures the utm parameters and an outside referrer on the first page", async () => {
    const { captureAttribution } = await page("https://news.example.com/letter");
    captureAttribution({
      href: "/markets/california?utm_source=letter&utm_medium=email&utm_campaign=fall",
    });
    expect(stored()).toMatchObject({
      first_touch: {
        landing_path: "/markets/california",
        referrer_host: "news.example.com",
        utm_source: "letter",
        utm_medium: "email",
        utm_campaign: "fall",
      },
      pages_viewed: 1,
    });
  });

  it("a second page overwrites neither the first touch nor the last touch", async () => {
    const { captureAttribution, readAttribution } = await page("https://news.example.com/letter");
    const first = captureAttribution({ href: "/?utm_source=letter" });
    captureAttribution({ href: "/stories" });
    expect(readAttribution()).toEqual({ ...first, pages_viewed: 2 });
  });

  it("counts 3 pages after the first render and two navigations", async () => {
    const { captureAttribution, readAttribution } = await page();
    captureAttribution({ href: "/" });
    captureAttribution({ href: "/markets" });
    captureAttribution({ href: "/stories" });
    expect(readAttribution()?.pages_viewed).toBe(3);
  });

  it("a second landing with utm_source=other replaces last_touch and keeps first_touch", async () => {
    const first = (await page()).captureAttribution({ href: "/?utm_source=letter" });
    const { captureAttribution, readAttribution } = await page("https://other.example.org/");
    captureAttribution({ href: "/homes?utm_source=other" });
    const after = readAttribution();
    expect(after?.first_touch).toEqual(first?.first_touch);
    expect(after?.last_touch).toMatchObject({
      landing_path: "/homes",
      referrer_host: "other.example.org",
      utm_source: "other",
    });
    expect(after?.pages_viewed).toBe(2);
  });

  it("sets no cookie", async () => {
    const { captureAttribution } = await page("https://news.example.com/");
    captureAttribution({ href: "/?utm_source=letter" });
    captureAttribution({ href: "/stories" });
    expect(document.cookie).toBe("");
  });

  it("sends nothing until the inquiry is submitted, then only inside it", async () => {
    const { captureAttribution, readAttribution } = await page("https://news.example.com/");
    captureAttribution({ href: "/?utm_source=letter" });
    captureAttribution({ href: "/stories" });
    expect(stored()).toMatchObject({ first_touch: { utm_source: "letter" }, pages_viewed: 2 });
    expect(carried()).toBe(false);

    const { createHttpServices } = await import("../../../src/services/http");
    await createHttpServices("/api/public", fetchSpy).inquiries.send(
      inquirySchema.parse({ ...validInquiry(), attribution: readAttribution() }),
    );
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(carried()).toBe(true);
  });

  it("gives undefined when storage is blocked, and the inquiry still parses", async () => {
    const { captureAttribution, readAttribution } = await page();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    expect(captureAttribution({ href: "/" })).toBeUndefined();
    expect(readAttribution()).toBeUndefined();
    expect(
      inquirySchema.parse({ ...validInquiry(), attribution: readAttribution() }).attribution,
    ).toBeUndefined();
  });
});
