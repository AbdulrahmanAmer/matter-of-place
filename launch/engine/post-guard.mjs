// W8 item 1, fresh Opus review of 2026-10-19: a still post's page is written by a model, so while the engine shoots it
// (still.mjs --frames) it reaches only the files a post is made of. The engine's server serves the repository root and
// Chrome reaches any host, so without this a page could read the runner checkout's .env and paint it, or send it out.
// Three locks, each enough alone for its part: every request of the page is intercepted and only 127.0.0.1 paths under
// POST_PATHS go on (guardPost); the server serves only those paths (`serve({ allow: postPathAllowed })`); and Chrome starts
// with a proxy that does not exist (POST_CHROME_ARGS), so a request the interception does not see (a WebSocket, a
// worker's fetch, WebRTC) has no way past this machine either.

/** The served paths a post's page may load: its own folder, the brand's files, the fonts and Three.js. */
const POST_PATHS = Object.freeze([
  "/app/.tmp/post/",
  "/brand/",
  "/app/public/fonts/",
  "/launch/node_modules/three/",
]);

/** True when a served path is under POST_PATHS and climbs out of none of them (a `..` segment, even encoded). */
export function postPathAllowed(pathname) {
  let path;
  try {
    path = decodeURIComponent(pathname);
  } catch {
    return false;
  }
  // an encoded slash (`..%2f`, or `..%5c`, a separator on Windows) survives the URL parser and is one once decoded
  if (/(^|[\\/])\.\.([\\/]|$)/.test(path)) return false;
  return POST_PATHS.some((prefix) => path.startsWith(prefix));
}

/** True when a post's page may make the request: a data or blob URL, or a path of POST_PATHS on the engine's server. */
export function postRequestAllowed(url, origin) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol === "data:" || parsed.protocol === "blob:") return true;
  return parsed.origin === origin && postPathAllowed(parsed.pathname);
}

/** Makes the page abort every request postRequestAllowed refuses. Call it before the page's first navigation. */
export async function guardPost(page, origin) {
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    if (request.isInterceptResolutionHandled()) return;
    if (postRequestAllowed(request.url(), origin)) void request.continue();
    else void request.abort("accessdenied");
  });
}

/**
 * Chrome's flags for a post: every host but this machine's loopback goes to a proxy at port 9, where nothing listens,
 * and WebRTC may not send outside a proxy. Chrome never proxies 127.0.0.1, so the engine's server stays reachable.
 */
export const POST_CHROME_ARGS = Object.freeze([
  "--proxy-server=http://127.0.0.1:9",
  "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
]);
