import { z } from "zod";
import { sha256Hex } from "../lib/crypto";
import { getDb, type Db } from "../lib/db";
import { AppError } from "../lib/errors";
import { browserCacheControl } from "../lib/pipeline";
import { readVar } from "../lib/runtime-env";
import { readState, servingStale } from "./state";

// The one module that stores and reads cached responses (invariant 16): the JSON routes, the HTML
// middleware and, through `mediaCached`, the media route. A cached public read is a function of release,
// catalog version, environment, host and path (H82), so a publish changes every key within 15 seconds and
// nothing is ever purged, and no Worker answers with a page another Worker rendered (P-3190).

type Kind = "html" | "json" | "doc";
type Label = "hit" | "miss" | "stale" | "bypass";

export interface EdgeOptions {
  sMaxAge: number;
  tags?: readonly string[];
}

const KEY_BASE = "https://cache.mop.internal";
const DEFAULT_EDGE_MAX_AGE: Record<Kind, number> = {
  html: 31_536_000,
  json: 31_536_000,
  doc: 3600,
};
const LAST_GOOD_MAX_AGE = 604_800;
const MISSING_CONTROL = "public, s-maxage=60";
const MEDIA_CONTROL = "public, max-age=31536000, immutable";
// What a stored copy keeps of a built response. The pipeline adds `x-request-id` and the security
// headers after the lookup; the policy and the preloads of an HTML page are part of what was rendered.
const KEPT_HEADERS = [
  "content-type",
  "content-security-policy",
  "content-security-policy-report-only",
  "link",
];

const edgeCacheSchema = z.object({
  default: z.custom<Cache>(
    (value) => typeof value === "object" && value !== null && "match" in value && "put" in value,
  ),
});

/**
 * The Worker's own edge cache; absent in `vite dev`. It stores and serves under `wrangler dev` and on every deploy,
 * workers.dev included, where every Worker of the account's subdomain reads the same store (P-843, P-3190).
 */
function edgeCache(): Cache | undefined {
  const parsed = edgeCacheSchema.safeParse(Reflect.get(globalThis, "caches"));
  return parsed.success ? parsed.data.default : undefined;
}

const release = (): string => readVar("SENTRY_RELEASE") ?? "dev";
/** `MOP_ENV` with `env.ts`'s default: an unset or empty value is production. */
function environment(): string {
  const value = readVar("MOP_ENV");
  return value === undefined || value === "" ? "production" : value;
}
// The dev Worker, the production Worker and every preview share one store on workers.dev (H82): the environment and
// the host the request named come first, so one never answers with another's illustrative or coming-soon render.
const scope = (url: URL): string => `${environment()}/${url.host}`;

/** The key of a stored read: environment, host, release, catalog version, kind and path, never the query (rule 3). */
export const versionedKey = (kind: Kind, version: number, url: URL): string =>
  `${KEY_BASE}/${scope(url)}/${release()}/v${String(version)}/${kind}${url.pathname}`;
/** The key of the last good copy. An HTML page names the hashed asset files of its own build, so its copy is bound to the release (DO-09). */
export const lastGoodKey = (kind: Kind, url: URL): string =>
  kind === "html"
    ? `${KEY_BASE}/last-good/${scope(url)}/${release()}/html${url.pathname}`
    : `${KEY_BASE}/last-good/${scope(url)}/${kind}${url.pathname}`;

// Per isolate: the catalog version at which each last-good key was written.
const lastGoodWritten = new Map<string, number>();

const isReadRequest = (request: Request): boolean =>
  request.method === "GET" || request.method === "HEAD";

/** A draft preview (B7 invariant 17 f): never looked up and never stored, though the key drops the query (rule 3). */
const isPreviewRequest = (url: string): boolean => {
  const search = new URL(url).searchParams;
  return search.has("preview") || search.has("draft_token");
};

/** 200, or the cacheable 404 and 410 that name their own short lifetime; never `no-store`, a cookie or a 5xx. */
function storable(response: Response): boolean {
  const control = response.headers.get("cache-control") ?? "";
  if (response.headers.has("set-cookie") || control.includes("no-store")) return false;
  if (response.status === 200) return true;
  return (response.status === 404 || response.status === 410) && control.includes("s-maxage=60");
}

async function toStored(
  response: Response,
  kind: Kind,
  version: number,
  edge: EdgeOptions | undefined,
): Promise<Response> {
  const body = await response.text();
  const headers = new Headers();
  for (const name of KEPT_HEADERS) {
    const value = response.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  if (response.status === 200) {
    const sMaxAge = edge?.sMaxAge ?? DEFAULT_EDGE_MAX_AGE[kind];
    headers.set("cache-control", `${browserCacheControl(kind)}, s-maxage=${String(sMaxAge)}`);
    headers.set("etag", `W/"cv${String(version)}-${(await sha256Hex(body)).slice(0, 16)}"`);
  } else {
    headers.set("cache-control", response.headers.get("cache-control") ?? MISSING_CONTROL);
  }
  if (edge?.tags !== undefined && edge.tags.length > 0)
    headers.set("cache-tag", edge.tags.join(","));
  headers.set("x-catalog-version", String(version));
  return new Response(body, { status: response.status, headers });
}

const matchesEtag = (request: Request, etag: string | null): boolean => {
  const sent = request.headers.get("if-none-match");
  return (
    etag !== null &&
    sent !== null &&
    sent.split(",").some((candidate) => candidate.trim() === "*" || candidate.trim() === etag)
  );
};

/** What leaves the Worker: the browser's lifetime only, the long edge lifetime stays on the stored copy. */
function answer(request: Request, stored: Response, kind: Kind, label: Label): Response {
  const headers = new Headers(stored.headers);
  headers.set("x-mop-cache", label);
  if (stored.status === 200) headers.set("cache-control", browserCacheControl(kind));
  if (stored.status === 200 && matchesEtag(request, headers.get("etag"))) {
    headers.delete("content-type");
    return new Response(null, { status: 304, headers });
  }
  return new Response(stored.body, { status: stored.status, headers });
}

function bypass(response: Response, version: number | undefined): Response {
  const headers = new Headers(response.headers);
  headers.set("x-mop-cache", "bypass");
  if (version !== undefined) headers.set("x-catalog-version", String(version));
  return new Response(response.body, { status: response.status, headers });
}

async function writeLastGood(
  cache: Cache,
  kind: Kind,
  url: URL,
  version: number,
  stored: Response,
): Promise<void> {
  const key = lastGoodKey(kind, url);
  if (lastGoodWritten.get(key) === version) return;
  const copy = new Response(stored.body, stored);
  copy.headers.set("cache-control", `public, s-maxage=${String(LAST_GOOD_MAX_AGE)}`);
  await cache.put(key, copy);
  lastGoodWritten.set(key, version);
}

async function serveLastGood(
  request: Request,
  kind: Kind,
  url: URL,
  failure: unknown,
): Promise<Response> {
  const kept =
    failure instanceof AppError && failure.code === "unavailable"
      ? await edgeCache()?.match(lastGoodKey(kind, url))
      : undefined;
  if (kept === undefined) throw failure;
  return answer(request, kept, kind, "stale");
}

/**
 * Answers a read from the edge cache under the versioned key, or builds it, stores it and answers.
 * When the database cannot be read, a last good copy answers `stale`; with none, the failure stands (503).
 * A render is a pure function of (release, version, environment, host, path), so a stored copy is never stale.
 */
export async function cachedResponse(
  request: Request,
  kind: Kind,
  build: () => Promise<Response>,
  edge?: EdgeOptions,
  db?: Db,
): Promise<Response> {
  if (isPreviewRequest(request.url) || !isReadRequest(request)) {
    return bypass(await build(), undefined);
  }
  const url = new URL(request.url);
  const cache = edgeCache();
  let version: number;
  let stateStale: boolean;
  try {
    const read = await readState(db ?? getDb());
    version = read.state.catalogVersion;
    stateStale = read.stale;
  } catch (error) {
    return serveLastGood(request, kind, url, error);
  }
  const key = versionedKey(kind, version, url);
  const hit = await cache?.match(key);
  if (hit !== undefined) return answer(request, hit, kind, stateStale ? "stale" : "hit");
  // An outage seen by a cold isolate (gap item 9: the state is the kept copy): the page's own last good copy first,
  // a build from the kept snapshot only when there is none.
  const kept = stateStale ? await cache?.match(lastGoodKey(kind, url)) : undefined;
  if (kept !== undefined) return answer(request, kept, kind, "stale");
  let built: Response;
  try {
    built = await build();
  } catch (error) {
    return serveLastGood(request, kind, url, error);
  }
  if (!storable(built)) return bypass(built, version);
  const stored = await toStored(built, kind, version, edge);
  const stale = stateStale || servingStale();
  if (cache !== undefined && !stale) {
    await cache.put(key, stored.clone());
    await writeLastGood(cache, kind, url, version, stored.clone());
  }
  return answer(request, stored, kind, stale ? "stale" : "miss");
}

/** `cachedResponse` for a JSON route, with the row's own edge options. */
export function edgeCached(
  request: Request,
  db: Db,
  build: () => Promise<Response>,
  edge: EdgeOptions,
): Promise<Response> {
  return cachedResponse(request, "json", build, edge, db);
}

/**
 * The media route's own layer (H33 (4)): keyed by the request's URL without its query, so the purge by
 * URL that takedown runs removes it. A key carries a content hash, so a stored image never changes.
 */
export async function mediaCached(
  request: Request,
  build: () => Promise<Response>,
): Promise<Response> {
  const { origin, pathname } = new URL(request.url);
  const key = `${origin}${pathname}`;
  const cache = edgeCache();
  const hit = await cache?.match(key);
  if (hit !== undefined) {
    const headers = new Headers(hit.headers);
    headers.set("x-mop-cache", "hit");
    return new Response(hit.body, { status: hit.status, headers });
  }
  const upstream = await build();
  const headers = new Headers();
  if (upstream.status !== 200) {
    headers.set("content-type", upstream.headers.get("content-type") ?? "application/json");
    headers.set("cache-control", "no-store");
    headers.set("x-mop-cache", "bypass");
    return new Response(upstream.body, { status: upstream.status, headers });
  }
  const body = await upstream.arrayBuffer();
  headers.set("content-type", upstream.headers.get("content-type") ?? "application/octet-stream");
  headers.set("content-length", String(body.byteLength));
  headers.set("cache-control", MEDIA_CONTROL);
  await cache?.put(key, new Response(body, { status: 200, headers }));
  headers.set("x-mop-cache", "miss");
  return new Response(body, { status: 200, headers });
}
