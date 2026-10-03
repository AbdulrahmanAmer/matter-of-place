import { siteConfig } from "../config/site";

/**
 * Analytics events. Every user action calls `track()`; add new names to
 * `analyticsEvents` rather than passing free strings so attribution stays typed.
 * The server's allow-list is this same list.
 *
 * Two sinks: `window.dataLayer` (for a tag manager) always, and the API's
 * `/events` endpoint through `sendBeacon` when an API base URL is configured.
 */
export const analyticsEvents = [
  "property_view",
  "gallery_engagement",
  "property_save",
  "share",
  "showing_request",
  "property_inquiry",
  "similar_property_request",
  "seller_intent",
  "investment_intent",
  "agent_contact",
  "submit_property",
  "package_interest",
  "newsletter_signup",
  "market_view",
  "region_view",
  "story_view",
  "contact_inquiry",
  "concierge_open",
  "filter_use",
  "search",
  "home_finder",
] as const;
export type AnalyticsEvent = (typeof analyticsEvents)[number];

type AnalyticsEnvelope = {
  event: AnalyticsEvent;
  path: string;
  at: string;
  data: Record<string, unknown>;
};

declare global {
  interface Window {
    dataLayer?: unknown[];
  }
}

export function track(event: AnalyticsEvent, data: Record<string, unknown> = {}) {
  if (typeof window === "undefined") return;
  const envelope: AnalyticsEnvelope = {
    event,
    path: window.location.pathname,
    at: new Date().toISOString(),
    data,
  };
  (window.dataLayer ??= []).push({ event, ...data, path: envelope.path, at: envelope.at });
  if (siteConfig.apiBaseUrl && typeof navigator.sendBeacon === "function") {
    const body = new Blob([JSON.stringify(envelope)], { type: "application/json" });
    navigator.sendBeacon(`${siteConfig.apiBaseUrl}/events`, body);
  }
}
