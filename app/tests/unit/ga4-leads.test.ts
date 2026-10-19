// @vitest-environment jsdom
// Lead events reach GA4 by name only, under consent, once gtag.js is in the page (operator, 2026-10-19).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { track } from "../../src/lib/analytics";
import { writeConsent } from "../../src/lib/consent";
import { ga4LeadEvents, sendGa4Lead } from "../../src/lib/ga4";

/** The gtag commands in the dataLayer: `arguments` objects, as gtag.js reads them. */
const gtagCalls = () =>
  (window.dataLayer ?? [])
    .filter(
      (entry) =>
        !Array.isArray(entry) && typeof entry === "object" && entry !== null && "length" in entry,
    )
    .map((entry) => Array.from(entry as ArrayLike<unknown>));

function addGtagScript() {
  const script = document.createElement("script");
  script.src = "https://www.googletagmanager.com/gtag/js?id=G-TEST";
  document.head.append(script);
}

describe("lead events in GA4", () => {
  beforeEach(() => {
    window.dataLayer = [];
    document.head.innerHTML = "";
    localStorage.clear();
    document.cookie = "mop_consent=; max-age=0; path=/";
  });
  afterEach(() => {
    document.head.innerHTML = "";
  });

  it("sends each lead by name alone once consent holds and gtag.js is in the page", () => {
    writeConsent(true);
    addGtagScript();
    track("contact_inquiry", { email: "someone@example.com", message: "hello" });
    expect(gtagCalls()).toEqual([["event", "contact_inquiry"]]);
    expect(ga4LeadEvents.map((name) => sendGa4Lead(name))).toEqual([true, true, true, true, true]);
  });

  it("sends nothing without consent, before gtag.js loads, or for an event that is not a lead", () => {
    addGtagScript();
    const withoutConsent = sendGa4Lead("submit_property");
    writeConsent(true);
    document.head.innerHTML = "";
    const beforeScript = sendGa4Lead("submit_property");
    addGtagScript();
    expect([withoutConsent, beforeScript, sendGa4Lead("property_view"), gtagCalls()]).toEqual([
      false,
      false,
      false,
      [],
    ]);
  });
});
