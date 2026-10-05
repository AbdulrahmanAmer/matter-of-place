import { consentCookie } from "../../lib/consent";
import { AppError, toErrorResponse } from "../lib/errors";

// The analytics choice without JavaScript (B17 step 4): a link in the `<noscript>` notice and on /privacy-choices.
// It answers each visitor its own cookie and redirect, reads no database and is never stored.

const badChoice = new AppError("bad_request", undefined, "The choice is accept or decline.");

/** The path of a same-origin `Referer`, else `/`; a path that starts with `//` would leave the site. */
function returnPath(request: Request): string {
  const referer = request.headers.get("referer");
  if (referer === null) return "/";
  try {
    const { origin, pathname } = new URL(referer);
    return origin === new URL(request.url).origin && !pathname.startsWith("//") ? pathname : "/";
  } catch {
    return "/";
  }
}

/** `?set=accept|decline` sets `mop_consent` and sends the visitor back; Global Privacy Control turns accept into decline. */
export function setConsent(request: Request, requestId: string): Response {
  const choice = new URL(request.url).searchParams.get("set");
  if (choice !== "accept" && choice !== "decline") return toErrorResponse(badChoice, requestId);
  const analytics = choice === "accept" && request.headers.get("sec-gpc") !== "1";
  return new Response(null, {
    status: 303,
    headers: {
      location: returnPath(request),
      "set-cookie": consentCookie(analytics),
      "cache-control": "private, no-store",
    },
  });
}
