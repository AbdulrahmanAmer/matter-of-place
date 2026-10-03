import { isIndexableHost } from "../seo/robots";
import { serverErrorHtml } from "./error-page";
import { AppError } from "./errors";
import { securityHeaders, type Flags } from "./headers";
import { logLine } from "./log";

export interface PipelineContext {
  env: { MOP_ENV?: string | undefined };
  waitUntil: (promise: Promise<unknown>) => void;
}

export interface PipelineDeps {
  /** Runs the request through the router and the server routes, which read the id (H39 (1)). */
  render: (request: Request, requestId: string) => Promise<Response>;
  /** A redirect for this path, or null (invariant 14). It must return a response whose headers can be set. */
  redirect: (request: Request) => Promise<Response | null>;
  /** The cache hook B3 fills. It must return a response whose headers can be set. */
  cache: (request: Request, render: () => Promise<Response>) => Promise<Response>;
  getFlags: () => Promise<Flags>;
  /** Sends an unhandled error to Sentry; never rejects. */
  report: (error: unknown, info: { requestId: string; route: string }) => Promise<void>;
  /** True when an API route file matches the path (decoded, lower case), for any method. */
  isApiRoute: (pathname: string) => boolean;
}

type CacheKind = "html" | "json" | "doc";

const BROWSER_CACHE_CONTROL: Record<CacheKind, string> = {
  html: "public, max-age=0, must-revalidate",
  json: "public, max-age=60",
  doc: "public, max-age=3600",
};

const REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;
const NOT_PAGE_PREFIXES = ["/api/", "/media/", "/.well-known/", "/_serverfn/"];
const NEVER_CACHED_PREFIXES = ["/api/admin/", "/api/hooks/"];
const KEPT_ESCAPES = /(%25|%5C)/i;
const ESCAPE = /%[0-9A-F]{2}/gi;

/** `decodeURI`, or each ASCII escape alone when the whole is malformed, as the router does. */
function decodeLikeRouter(text: string): string {
  try {
    return decodeURI(text);
  } catch {
    return text.replace(ESCAPE, (escape) =>
      Number.parseInt(escape.slice(1), 16) < 0x80 ? decodeURI(escape) : escape,
    );
  }
}

/**
 * The path as the router matches it (`decodePath` in `@tanstack/router-core`): escapes decoded
 * except `%25` and `%5C`, leading slashes made one, case ignored. `/API/x`, `/%61pi/x` and
 * `//api/x` all reach the `/api/x` route, so every prefix rule reads this form.
 */
export function routePath(pathname: string): string {
  const decoded = pathname
    .split(KEPT_ESCAPES)
    .map((part, index) => (index % 2 === 1 ? part : decodeLikeRouter(part)))
    .join("");
  return `/${decoded.replace(/^\/+/, "")}`.toLowerCase();
}

const isAdmin = (path: string) => path === "/admin" || path.startsWith("/admin/");

/** What the browser may keep; the edge lifetime belongs to the stored copy inside B3's module. */
export function browserCacheControl(kind: CacheKind): string {
  return BROWSER_CACHE_CONTROL[kind];
}

/** A page is HTML rendered by the router. A dotted last segment is a document (`/robots.txt`). */
export function isPageRequest(pathname: string): boolean {
  const path = routePath(pathname);
  if (isAdmin(path) || NOT_PAGE_PREFIXES.some((prefix) => path.startsWith(prefix))) {
    return false;
  }
  return !(path.split("/").at(-1) ?? "").includes(".");
}

/**
 * Architecture 13 rule 6, plus the 406 of ASSUMED H41 (1), which rule 6 does not name yet.
 * Without `response` it answers for the request alone, which decides whether the cache hook may
 * run; with it, also for a cookie, a 5xx or the 406 that depends on the request's `Accept`.
 */
export function neverCached(request: Request, pathname: string, response?: Response): boolean {
  const search = new URL(request.url).searchParams;
  const path = routePath(pathname);
  return (
    (request.method !== "GET" && request.method !== "HEAD") ||
    isAdmin(path) ||
    NEVER_CACHED_PREFIXES.some((prefix) => path.startsWith(prefix)) ||
    search.has("preview") ||
    search.has("draft_token") ||
    (response !== undefined &&
      (response.headers.has("set-cookie") || response.status >= 500 || response.status === 406))
  );
}

function requestIdOf(request: Request): string {
  const inbound = request.headers.get("x-request-id");
  return inbound !== null && REQUEST_ID.test(inbound) ? inbound : crypto.randomUUID();
}

const ERROR_MESSAGES = {
  not_found: "There is nothing at this address.",
  method_not_allowed: "This address does not accept that method.",
  not_acceptable: "This address answers with a web page only.",
  server: "Something went wrong. Please try again in a moment.",
  unavailable: "The service is busy. Please try again in a moment.",
} as const;

/** The R09 error body, never stored. B3's `toErrorResponse` in `errors.ts` takes this over. */
export function errorJson(
  status: number,
  code: keyof typeof ERROR_MESSAGES,
  requestId: string,
): Response {
  return Response.json(
    { error: { code, message: ERROR_MESSAGES[code], requestId } },
    { status, headers: { "cache-control": "no-store" } },
  );
}

// Seconds a client waits after a dependency outage (R09).
const OUTAGE_RETRY_AFTER = "30";

/** The calm failure page or R09 body: 503 `unavailable` for an outage (invariant 16), 500 `server` for anything else. */
function calmServerError(
  request: Request,
  underApi: boolean,
  requestId: string,
  outage: boolean,
): Response {
  const readsPage = request.method === "GET" || request.method === "HEAD";
  const wantsHtml =
    readsPage && !underApi && (request.headers.get("accept") ?? "").includes("text/html");
  const status = outage ? 503 : 500;
  const response = wantsHtml
    ? new Response(serverErrorHtml(requestId), {
        status,
        headers: { "content-type": "text/html; charset=utf-8" },
      })
    : errorJson(status, outage ? "unavailable" : "server", requestId);
  if (outage) response.headers.set("retry-after", OUTAGE_RETRY_AFTER);
  return response;
}

/**
 * H39 (2): the router renders an API route file that has no handler for the method as a page.
 * Under `/api/` that page becomes R09 JSON: 405 when it rendered 200, else its own status.
 */
function apiShellGuard(underApi: boolean, response: Response, requestId: string): Response {
  const html = (response.headers.get("content-type") ?? "").toLowerCase().startsWith("text/html");
  if (!underApi || !html) return response;
  return response.status === 200
    ? errorJson(405, "method_not_allowed", requestId)
    : errorJson(response.status, "not_found", requestId);
}

// Start's router refuses a request whose Accept names neither `*/*` nor `text/html` with a bare
// 500 `{ "error": "<text>" }` once no handler took it (`executeRouter` in createStartHandler.js).
async function refusedByRouter(request: Request, response: Response): Promise<boolean> {
  const accepts = (request.headers.get("accept") || "*/*").split(",").map((part) => part.trim());
  if (
    response.status !== 500 ||
    accepts.some((part) => part.startsWith("*/*") || part.startsWith("text/html"))
  ) {
    return false;
  }
  const body: unknown = await response
    .clone()
    .json()
    .catch(() => null);
  return (
    typeof body === "object" && body !== null && "error" in body && typeof body.error === "string"
  );
}

/**
 * The request pipeline of invariant 10, outside to inside: request id, never-cached rule, cache
 * hook, render. Headers are added after the cache hook returns, so a stored render is the same
 * for every visitor.
 */
export async function handle(
  request: Request,
  ctx: PipelineContext,
  deps: PipelineDeps,
): Promise<Response> {
  const requestId = requestIdOf(request);
  const { pathname } = new URL(request.url);
  const path = routePath(pathname);
  const underApi = path.startsWith("/api/");
  const mopEnv = ctx.env.MOP_ENV ?? "production";
  let flags: Flags = {};
  let response: Response;
  let redirected = false;
  try {
    flags = await deps.getFlags();
    const render = () => deps.render(request, requestId);
    // Only a public page is looked up for a redirect or stored; `/media/`, documents, the API and the admin never are.
    const page = !neverCached(request, pathname) && isPageRequest(pathname);
    const redirect = page ? await deps.redirect(request) : null;
    redirected = redirect !== null;
    response = redirect ?? (page ? await deps.cache(request, render) : await render());
  } catch (error) {
    // A page that cannot read the database and holds no last good copy is an outage, already logged and
    // reported once a minute by the read path: it answers 503, not an unhandled error.
    const outage = error instanceof AppError && error.code === "unavailable";
    if (!outage) {
      logLine("error", "unhandled_error", { requestId, route: pathname });
      ctx.waitUntil(deps.report(error, { requestId, route: pathname }));
    }
    response = calmServerError(request, underApi, requestId, outage);
  }
  const refused = await refusedByRouter(request, response);
  if (refused && underApi) {
    response = deps.isApiRoute(path)
      ? errorJson(405, "method_not_allowed", requestId)
      : errorJson(404, "not_found", requestId);
  } else if (refused) {
    response = errorJson(406, "not_acceptable", requestId);
  }
  response = apiShellGuard(underApi, response, requestId);

  const headers = response.headers;
  headers.set("x-request-id", requestId);
  if (neverCached(request, pathname, response)) {
    headers.set("cache-control", "no-store");
  } else if (!redirected && isPageRequest(pathname)) {
    headers.set("cache-control", browserCacheControl("html"));
  }
  const hasPolicy =
    headers.has("content-security-policy") || headers.has("content-security-policy-report-only");
  for (const [name, value] of Object.entries(securityHeaders(mopEnv, flags))) {
    if (!(hasPolicy && name.startsWith("Content-Security-Policy"))) headers.set(name, value);
  }
  if (!isIndexableHost(request.headers.get("host") ?? new URL(request.url).host, mopEnv)) {
    headers.set("x-robots-tag", "noindex, nofollow");
  }
  return response;
}
