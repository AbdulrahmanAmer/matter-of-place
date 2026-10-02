import { isIndexableHost } from "../seo/robots";
import { serverErrorHtml } from "./error-page";
import { securityHeaders, type Flags } from "./headers";
import { logLine } from "./log";

export interface PipelineContext {
  env: { MOP_ENV?: string | undefined };
  waitUntil: (promise: Promise<unknown>) => void;
}

export interface PipelineDeps {
  /** Runs the request through the router and the server routes. */
  render: (request: Request) => Promise<Response>;
  /** The cache hook B3 fills. It must return a response whose headers can be set. */
  cache: (request: Request, render: () => Promise<Response>) => Promise<Response>;
  getFlags: () => Promise<Flags>;
  /** Sends an unhandled error to Sentry; never rejects. */
  report: (error: unknown, info: { requestId: string; route: string }) => Promise<void>;
}

type CacheKind = "html" | "json" | "doc";

const BROWSER_CACHE_CONTROL: Record<CacheKind, string> = {
  html: "public, max-age=0, must-revalidate",
  json: "public, max-age=60",
  doc: "public, max-age=3600",
};

const REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;
const NOT_PAGE_PREFIXES = ["/api/", "/media/", "/.well-known/", "/_serverFn/"];
const NEVER_CACHED_PREFIXES = ["/api/admin/", "/api/hooks/"];

const isAdmin = (pathname: string) => pathname === "/admin" || pathname.startsWith("/admin/");

/** What the browser may keep; the edge lifetime belongs to the stored copy inside B3's module. */
export function browserCacheControl(kind: CacheKind): string {
  return BROWSER_CACHE_CONTROL[kind];
}

/** A page is HTML rendered by the router. A dotted last segment is a document (`/robots.txt`). */
export function isPageRequest(pathname: string): boolean {
  if (isAdmin(pathname) || NOT_PAGE_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return false;
  }
  return !(pathname.split("/").at(-1) ?? "").includes(".");
}

/**
 * Architecture 13 rule 6. Without `response` it answers for the request alone, which decides
 * whether the cache hook may run; with it, also for a cookie or a 5xx.
 */
export function neverCached(request: Request, pathname: string, response?: Response): boolean {
  const search = new URL(request.url).searchParams;
  return (
    (request.method !== "GET" && request.method !== "HEAD") ||
    isAdmin(pathname) ||
    NEVER_CACHED_PREFIXES.some((prefix) => pathname.startsWith(prefix)) ||
    search.has("preview") ||
    search.has("draft_token") ||
    (response !== undefined && (response.headers.has("set-cookie") || response.status >= 500))
  );
}

function requestIdOf(request: Request): string {
  const inbound = request.headers.get("x-request-id");
  return inbound !== null && REQUEST_ID.test(inbound) ? inbound : crypto.randomUUID();
}

function calmServerError(request: Request, pathname: string, requestId: string): Response {
  const readsPage = request.method === "GET" || request.method === "HEAD";
  const wantsHtml =
    readsPage &&
    !pathname.startsWith("/api/") &&
    (request.headers.get("accept") ?? "").includes("text/html");
  return wantsHtml
    ? new Response(serverErrorHtml(requestId), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      })
    : Response.json({ error: { code: "server", requestId } }, { status: 500 });
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
  const mopEnv = ctx.env.MOP_ENV ?? "production";
  let flags: Flags = {};
  let response: Response;
  try {
    flags = await deps.getFlags();
    const render = () => deps.render(request);
    response =
      !neverCached(request, pathname) && isPageRequest(pathname)
        ? await deps.cache(request, render)
        : await render();
  } catch (error) {
    logLine("error", "unhandled_error", { requestId, route: pathname });
    ctx.waitUntil(deps.report(error, { requestId, route: pathname }));
    response = calmServerError(request, pathname, requestId);
  }

  const headers = response.headers;
  headers.set("x-request-id", requestId);
  if (neverCached(request, pathname, response)) {
    headers.set("cache-control", "no-store");
  } else if (isPageRequest(pathname)) {
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
