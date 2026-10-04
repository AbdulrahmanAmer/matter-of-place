import { attributionSchema, type Attribution, type AttributionTouch } from "../domain/contracts";

// B15 invariant 4: first-party, cookie-free attribution. The session's first touch, its last touch and a page counter
// live in `sessionStorage` and leave the browser only inside an inquiry, read by the submit handler.

const STORAGE_KEY = "mop_attribution";
const MAX_TEXT = 200;
const UTM_NAMES = ["utm_source", "utm_medium", "utm_campaign", "utm_content"] as const;

interface Visit {
  url: URL;
  /** The document's referrer; a client navigation has none of its own. */
  referrer: string | undefined;
  now: Date;
}

function cut(value: string | null | undefined): string | undefined {
  const text = value?.slice(0, MAX_TEXT);
  return text === undefined || text === "" ? undefined : text;
}

function externalHost(referrer: string | undefined, url: URL): string | undefined {
  if (referrer === undefined || !URL.canParse(referrer)) return undefined;
  const { host } = new URL(referrer);
  return host === url.host ? undefined : cut(host);
}

/** The touch a visit makes, and whether it is a new arrival (a campaign parameter, or a referrer on another host). */
function touchOf({ url, referrer, now }: Visit): { touch: AttributionTouch; arrival: boolean } {
  const params = url.searchParams;
  const referrerHost = externalHost(referrer, url);
  const touch: AttributionTouch = {
    landing_path: cut(url.pathname),
    referrer_host: referrerHost,
    utm_source: cut(params.get("utm_source")),
    utm_medium: cut(params.get("utm_medium")),
    utm_campaign: cut(params.get("utm_campaign")),
    utm_content: cut(params.get("utm_content")),
    at: now.toISOString(),
  };
  const arrival = referrerHost !== undefined || UTM_NAMES.some((name) => params.has(name));
  return { touch, arrival };
}

/**
 * The attribution after one more page: the first call of a session sets both touches, a later arrival replaces only
 * the last touch, and every call counts one page.
 */
export function nextAttribution(stored: Attribution | undefined, visit: Visit): Attribution {
  const { touch, arrival } = touchOf(visit);
  if (stored === undefined) return { first_touch: touch, last_touch: touch, pages_viewed: 1 };
  return {
    ...stored,
    ...(arrival && { last_touch: touch }),
    pages_viewed: (stored.pages_viewed ?? 0) + 1,
  };
}

/** The session's attribution, or undefined when nothing is stored or storage is blocked. */
export function readAttribution(): Attribution | undefined {
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (stored === null) return undefined;
    const parsed = attributionSchema.safeParse(JSON.parse(stored));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

// The referrer belongs to the document's own load, so only the first capture after a page load reads it.
let documentReferrer: string | undefined =
  typeof document === "undefined" ? undefined : document.referrer;

/**
 * Counts one page of the session at `location` (the first client render or a resolved navigation) and returns what
 * is stored, or undefined when storage is blocked.
 */
export function captureAttribution(location: { href: string }): Attribution | undefined {
  const referrer = documentReferrer;
  documentReferrer = undefined;
  try {
    const next = nextAttribution(readAttribution(), {
      url: new URL(location.href, window.location.origin),
      referrer,
      now: new Date(),
    });
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    return next;
  } catch {
    return undefined;
  }
}
