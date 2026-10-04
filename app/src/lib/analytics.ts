import { siteConfig } from "../config/site";
import { utmSchema, type Utm } from "../domain/contracts";
import { consentGranted } from "./consent";

/**
 * Analytics events. Every user action calls `track()`; add new names to
 * `analyticsEvents` rather than passing free strings so attribution stays typed.
 * The server's allow-list is this same list.
 *
 * Two sinks: `window.dataLayer` (for a tag manager) at once, and the API's
 * `/events` endpoint when an API base URL is configured: events queue and leave
 * in `sendBeacon` batches of at most 20, every 10 seconds and when the page is hidden.
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
  "interest_signup",
  "coming_soon_view",
  "consent_set",
  "web_vitals",
  "csp_report",
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

const FLUSH_MS = 10_000;
const BATCH_SIZE = 20;
const UTM_KEY = "mop_utm";
const UTM_NAMES = ["utm_source", "utm_medium", "utm_campaign"] as const;

const queue: AnalyticsEnvelope[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;
let listening = false;
let utmAllowed: () => boolean = () => false;

/** Campaign attribution (G45) is sent only while the visitor's consent holds. */
export function setUtmConsent(check: () => boolean): void {
  utmAllowed = check;
}
// Read lazily inside `track`, so no storage is touched while the module loads on the server (G50).
setUtmConsent(consentGranted);

/** The campaign parameters of an address, each cut to 100 characters, a missing one left out. */
function readUtm(search: string): Utm | undefined {
  const params = new URLSearchParams(search);
  const found = UTM_NAMES.flatMap((name) => {
    const value = params.get(name)?.slice(0, 100);
    return value === undefined || value === "" ? [] : [[name, value] as const];
  });
  return found.length === 0 ? undefined : Object.fromEntries(found);
}

// The landing page is the page this module loaded on.
const landingUtm = typeof window === "undefined" ? undefined : readUtm(window.location.search);

/** The session's attribution: kept in `sessionStorage` from the first allowed event, never overwritten. */
function sessionUtm(): Utm | undefined {
  if (!utmAllowed()) return undefined;
  try {
    const stored = sessionStorage.getItem(UTM_KEY);
    if (stored === null) {
      if (landingUtm !== undefined) sessionStorage.setItem(UTM_KEY, JSON.stringify(landingUtm));
      return landingUtm;
    }
    const parsed = utmSchema.safeParse(JSON.parse(stored));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

function send(batch: AnalyticsEnvelope[]): void {
  const body = new Blob([JSON.stringify(batch)], { type: "application/json" });
  navigator.sendBeacon(`${siteConfig.apiBaseUrl ?? ""}/events`, body);
}

/** Sends everything queued, 20 events to a beacon (architecture 13 rule 8). An empty queue sends nothing. */
function flush(): void {
  clearTimeout(timer);
  timer = undefined;
  while (queue.length > 0) send(queue.splice(0, BATCH_SIZE));
}

function enqueue(envelope: AnalyticsEnvelope): void {
  queue.push(envelope);
  if (!listening) {
    listening = true;
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flush();
    });
  }
  timer ??= setTimeout(flush, FLUSH_MS);
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
    const utm = sessionUtm();
    enqueue(utm === undefined ? envelope : { ...envelope, data: { ...data, utm } });
  }
}
