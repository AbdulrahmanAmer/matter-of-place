// @vitest-environment jsdom
// `track()` pushes to window.dataLayer at once. The beacon half (queue, flush, batch size) is analytics-batch.test.ts.
import { beforeEach, describe, expect, it } from "vitest";
import { track, type AnalyticsEvent } from "../../src/lib/analytics";

// `Record<AnalyticsEvent, true>` fails the typecheck when a name is added to or dropped from the union without this list.
const everyEvent: Record<AnalyticsEvent, true> = {
  property_view: true,
  gallery_engagement: true,
  property_save: true,
  share: true,
  showing_request: true,
  property_inquiry: true,
  similar_property_request: true,
  seller_intent: true,
  investment_intent: true,
  agent_contact: true,
  submit_property: true,
  package_interest: true,
  newsletter_signup: true,
  newsletter_confirmed: true,
  market_view: true,
  region_view: true,
  story_view: true,
  contact_inquiry: true,
  concierge_open: true,
  filter_use: true,
  search: true,
  home_finder: true,
  interest_signup: true,
  coming_soon_view: true,
  consent_set: true,
  web_vitals: true,
  csp_report: true,
  archive_view: true,
};
const names = Object.keys(everyEvent).filter((name): name is AnalyticsEvent => name in everyEvent);

beforeEach(() => {
  window.dataLayer = [];
  window.history.pushState({}, "", "/california/la-jolla");
});

describe("track", () => {
  it("pushes every event name to dataLayer at once with event, path and at", () => {
    for (const name of names) track(name);
    const pushed = (window.dataLayer ?? []).map((entry) => ({
      event: typeof entry === "object" && entry !== null && "event" in entry ? entry.event : null,
      path: typeof entry === "object" && entry !== null && "path" in entry ? entry.path : null,
      at: typeof entry === "object" && entry !== null && "at" in entry ? entry.at : null,
    }));
    expect(pushed.map(({ event, path }) => ({ event, path }))).toEqual(
      names.map((event) => ({ event, path: "/california/la-jolla" })),
    );
    expect(
      pushed.filter(({ at }) => typeof at !== "string" || new Date(at).toISOString() !== at),
    ).toEqual([]);
  });

  it("carries the data given with the event", () => {
    track("property_save", { slug: "the-glass-house", market: "california" });
    expect(window.dataLayer).toEqual([
      expect.objectContaining({
        event: "property_save",
        slug: "the-glass-house",
        market: "california",
        path: "/california/la-jolla",
      }),
    ]);
  });

  it("starts the dataLayer when the page has none", () => {
    delete window.dataLayer;
    track("share");
    expect(window.dataLayer).toHaveLength(1);
  });
});
