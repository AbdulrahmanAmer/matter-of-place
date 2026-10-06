// The minimal offline worker (B17 invariant 19): it keeps the shell and the offline page, never the catalog.
// Navigations go to the network first and fall back to /offline.html; /api/ and /admin are never touched.
const CACHE = "mop-shell-v1";
const OFFLINE = "/offline.html";
const FONTS = [
  "/fonts/jost-latin-wght-normal.woff2",
  "/fonts/cormorant-garamond-latin-wght-normal.woff2",
];
const STYLESHEET = /<link\b[^>]*\brel="stylesheet"[^>]*\bhref="(\/[^"]+)"/g;

// A redirected response cannot answer a navigation, so each copy is stored as a fresh response.
async function store(cache, path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${path} answered ${response.status}`);
  await cache.put(path, new Response(await response.blob(), response));
}

async function install() {
  const cache = await caches.open(CACHE);
  const shell = await fetch("/");
  if (!shell.ok) throw new Error(`/ answered ${shell.status}`);
  const html = await shell.text();
  await cache.put("/", new Response(html, shell));
  const stylesheets = [...html.matchAll(STYLESHEET)].map((match) => match[1]);
  await Promise.all([OFFLINE, ...FONTS, ...stylesheets].map((path) => store(cache, path)));
}

self.addEventListener("install", (event) => {
  event.waitUntil(install().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  const path = url.pathname.toLowerCase();
  if (
    request.method !== "GET" ||
    url.origin !== self.location.origin ||
    path.startsWith("/api/") ||
    path === "/admin" ||
    path.startsWith("/admin/")
  ) {
    return;
  }
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE)));
    return;
  }
  event.respondWith(caches.match(request).then((hit) => hit ?? fetch(request)));
});
