import { z, ZodError } from "zod";
import { honeypotFieldName } from "../../domain/contracts";
import { getDb, type Db } from "../lib/db";
import { env, sentryOptions } from "../lib/env";
import { AppError, fromZod, toErrorResponse } from "../lib/errors";
import { clientIp, hashKey } from "../lib/ids";
import { logLine } from "../lib/log";
import { checkDb, checkMemory, type DbCheck, type LimitResult } from "../lib/ratelimit";
import { captureException } from "../lib/sentry";
import { verifyTurnstile } from "../lib/turnstile";
import { waitUntilOf, type WaitUntil } from "../lib/wait-until";
import { edgeCached } from "./cache";
import { ipHashOf, logRequest } from "./request-log";
import { routes, type PublicCtx, type PublicRoute } from "./routes";
import { drainStaleReports } from "./state";

// The public request pipeline (invariants 1, 2, 15 to 17): route and method, then the cache for a
// read, or for a write the size cap, content type, memory limits, schema, database limits and the
// service. A route file only calls `handlePublic`.

const MAX_BODY_BYTES = 65_536;
const FORM_LIMIT = { limit: 30, windowMs: 60_000 };
const MISSING_CONTROL = "public, s-maxage=60";

interface Match {
  route: PublicRoute;
  /** The values of the path's `:name` segments, in order. */
  params: string[];
}

/** The values of `:name` segments when `pathname` has the shape of `pattern`, else undefined. */
function capture(pattern: string, pathname: string): string[] | undefined {
  const wanted = pattern.split("/");
  const given = pathname.split("/");
  if (wanted.length !== given.length) return undefined;
  const values: string[] = [];
  for (const [index, part] of wanted.entries()) {
    const segment = given[index] ?? "";
    if (!part.startsWith(":")) {
      if (part !== segment) return undefined;
    } else {
      if (segment === "") return undefined;
      try {
        values.push(decodeURIComponent(segment));
      } catch {
        return undefined;
      }
    }
  }
  return values;
}

/** `submissions/:id/uploads` is the route `submissions-uploads`: the name of its buckets (G72). */
function routeName(path: string): string {
  return path
    .replace(/^\/api\/(?:public\/)?/, "")
    .split("/")
    .filter((part) => !part.startsWith(":"))
    .join("-");
}

const objectSchema = z.record(z.string(), z.unknown());

const emailSchema = z.union([
  z.object({ email: z.string() }),
  z.object({ submitterEmail: z.string() }),
]);

/** The address a per-email limit counts: the `email` of a form, the `submitterEmail` of a submission. */
function emailOf(input: unknown): string | undefined {
  const parsed = emailSchema.safeParse(input);
  if (!parsed.success) return undefined;
  return ("email" in parsed.data ? parsed.data.email : parsed.data.submitterEmail)
    .trim()
    .toLowerCase();
}

function refused(requestId: string, retryAfter: number): Response {
  const response = toErrorResponse(
    new AppError(
      "rate_limited",
      undefined,
      "Too many requests. Please try again in a little while.",
    ),
    requestId,
  );
  response.headers.set("retry-after", String(retryAfter));
  return response;
}

function methodNotAllowed(requestId: string, candidates: readonly Match[]): Response {
  const allowed = new Set(candidates.map(({ route }) => route.method));
  const response = toErrorResponse(
    new AppError("method_not_allowed", undefined, "This address does not accept that method."),
    requestId,
  );
  response.headers.set(
    "allow",
    [...allowed].flatMap((method) => (method === "GET" ? ["GET", "HEAD"] : [method])).join(", "),
  );
  return response;
}

async function readJson(request: Request): Promise<unknown> {
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    throw new AppError("bad_request", undefined, "Send the details as JSON.");
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) {
    throw new AppError("payload_too_large", undefined, "That is more than we can take in one go.");
  }
  try {
    const body: unknown = JSON.parse(text);
    return body;
  } catch {
    throw new AppError("bad_request", undefined, "The details could not be read.");
  }
}

const tooLarge = (request: Request): boolean =>
  Number(request.headers.get("content-length") ?? "0") > MAX_BODY_BYTES;

/**
 * Takes the honeypot field off a JSON object body (invariant 11). `filled` is true when it held anything: such a
 * request gets a receipt that looks like any other and nothing is written.
 */
function stripHoneypot(body: unknown): { body: unknown; filled: boolean } {
  const fields = objectSchema.safeParse(body);
  if (!fields.success) return { body, filled: false };
  const { [honeypotFieldName]: trap, ...rest } = fields.data;
  return { body: rest, filled: trap !== undefined && trap !== null && trap !== "" };
}

/** A write with `:name` segments parses them with its body, under their own names, which the body cannot override. */
function withParams(body: unknown, path: string, params: readonly string[]): unknown {
  const names = path
    .split("/")
    .filter((part) => part.startsWith(":"))
    .map((part) => part.slice(1));
  if (names.length === 0) return body;
  const fields = objectSchema.safeParse(body);
  return {
    ...(fields.success ? fields.data : {}),
    ...Object.fromEntries(names.map((name, index) => [name, params[index]])),
  };
}

function fromService(route: PublicRoute, value: unknown): Response {
  if (value instanceof Response) return value;
  const headers = { "cache-control": "no-store" };
  return route.status === 204
    ? new Response(null, { status: 204, headers })
    : Response.json(value, { status: route.status, headers });
}

async function read(match: Match, request: Request, db: Db, ctx: PublicCtx): Promise<Response> {
  const { route, params } = match;
  if (route.raw === true || route.cache === undefined) {
    throw new AppError("server", undefined, "A read route needs its cache options.");
  }
  const input = route.schema === undefined ? undefined : route.schema.parse(params[0]);
  const tags = route.cache.tags.map((tag) => tag.replace("$slug", params[0] ?? ""));
  const mayBeGone = route.cache.gone === true;
  const build = async (): Promise<Response> => {
    try {
      return Response.json(await route.service(db, input, ctx), { status: route.status });
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
      if (error.code !== "not_found" && !(error.code === "gone" && mayBeGone)) throw error;
      // The cacheable 404 and 410 name no request: the same body answers every visitor (invariant 16).
      return Response.json(
        { error: { code: error.code, message: error.message } },
        { status: error.status, headers: { "cache-control": MISSING_CONTROL } },
      );
    }
  };
  return edgeCached(request, db, build, { sMaxAge: route.cache.sMaxAge, tags });
}

function memoryCheck(route: PublicRoute, name: string, key: string): LimitResult {
  const checks = [
    ...(route.form === true ? [{ bucket: `${name}:form`, ...FORM_LIMIT }] : []),
    ...route.limits
      .filter((limit) => limit.store === "memory")
      .map((limit) => ({
        bucket: `${name}:${limit.scope}`,
        limit: limit.limit,
        windowMs: limit.windowSeconds * 1000,
      })),
  ];
  for (const check of checks) {
    const result = checkMemory(check.bucket, key, check.limit, check.windowMs);
    if (!result.ok) return result;
  }
  return { ok: true };
}

async function dbChecks(
  route: PublicRoute,
  name: string,
  ipHash: string,
  input: unknown,
): Promise<DbCheck[]> {
  const email = emailOf(input);
  const checks: DbCheck[] = [];
  for (const limit of route.limits.filter((candidate) => candidate.store === "db")) {
    const subject = limit.scope === "ip" ? ipHash : email;
    if (subject === undefined) continue;
    checks.push({
      bucket: `${name}:${limit.scope}`,
      keyHash: limit.scope === "ip" ? subject : await hashKey(env.RATE_LIMIT_SALT, subject),
      limit: limit.limit,
      windowSeconds: limit.windowSeconds,
    });
  }
  return checks;
}

/**
 * The three outcomes of GD-05: a failed check is 403, an unreachable one lets the write through flagged
 * (`ctx.turnstileOk` false) and logged. A row that declares no check skips it.
 */
async function checkTurnstile(
  route: PublicRoute,
  name: string,
  request: Request,
  ctx: PublicCtx,
): Promise<void> {
  if (!route.turnstile) return;
  const outcome = await verifyTurnstile(
    request.headers.get("x-turnstile-token"),
    clientIp(request),
    env,
    name,
  );
  if (outcome === "fail") {
    throw new AppError(
      "forbidden",
      undefined,
      "We could not check this came from a person. Please reload the page and try again.",
    );
  }
  if (outcome === "unreachable") logLine("warn", "turnstile_unreachable", { route: name });
  ctx.turnstileOk = outcome === "pass";
}

async function write(match: Match, request: Request, db: Db, ctx: PublicCtx): Promise<Response> {
  const { route } = match;
  if (tooLarge(request)) {
    throw new AppError("payload_too_large", undefined, "That is more than we can take in one go.");
  }
  if (route.raw === true) return route.service(request, db, env);
  const { body, filled } = stripHoneypot(await readJson(request));
  const name = routeName(route.path);
  if (filled) {
    logLine("info", "honeypot", { route: name });
    return Response.json(
      { id: crypto.randomUUID(), receivedAt: new Date().toISOString() },
      { status: 201, headers: { "cache-control": "no-store" } },
    );
  }
  const memory = memoryCheck(route, name, ctx.ipHash);
  if (!memory.ok) return refused(ctx.requestId, memory.retryAfter);
  await checkTurnstile(route, name, request, ctx);
  const parsed =
    route.schema === undefined
      ? undefined
      : route.schema.safeParse(withParams(body, route.path, match.params));
  if (parsed?.success === false) throw fromZod(parsed.error);
  const input: unknown = parsed?.data;
  const limited = await dbLimited(db, route, name, ctx, input);
  if (limited !== null) return limited;
  return fromService(route, await route.service(db, input, ctx));
}

/** The 429 of the row's database limits, or null when every check passed and its hit is counted. */
async function dbLimited(
  db: Db,
  route: PublicRoute,
  name: string,
  ctx: PublicCtx,
  input: unknown,
): Promise<Response | null> {
  const checks = await dbChecks(route, name, ctx.ipHash, input);
  if (checks.length === 0) return null;
  const limited = await checkDb(db, checks);
  return limited.ok ? null : refused(ctx.requestId, limited.retryAfter);
}

/**
 * A GET that is never cached (the confirm link): limited like a write, and its service takes the query string
 * unparsed, so it can answer a bad value with its own redirect instead of a 422.
 */
async function uncachedRead(
  match: Match,
  request: Request,
  db: Db,
  ctx: PublicCtx,
): Promise<Response> {
  const { route } = match;
  if (route.raw === true) throw new AppError("server", undefined, "A raw row is a POST.");
  const name = routeName(route.path);
  const memory = memoryCheck(route, name, ctx.ipHash);
  if (!memory.ok) return refused(ctx.requestId, memory.retryAfter);
  const limited = await dbLimited(db, route, name, ctx, undefined);
  if (limited !== null) return limited;
  const query = Object.fromEntries(new URL(request.url).searchParams);
  return fromService(route, await route.service(db, query, ctx));
}

async function dispatch(
  request: Request,
  db: Db,
  ctx: PublicCtx,
  pathname: string,
): Promise<{ response: Response; label: string }> {
  const candidates = routes.flatMap((route) => {
    const params = capture(route.path, pathname);
    return params === undefined ? [] : [{ route, params }];
  });
  const method = request.method === "HEAD" ? "GET" : request.method;
  const match = candidates.find(({ route }) => route.method === method);
  if (candidates.length === 0) {
    throw new AppError("not_found", undefined, "There is nothing at this address.");
  }
  if (match === undefined) {
    return { response: methodNotAllowed(ctx.requestId, candidates), label: pathname };
  }
  let response: Response;
  if (match.route.method === "POST") response = await write(match, request, db, ctx);
  else if (match.route.cache === undefined) response = await uncachedRead(match, request, db, ctx);
  else response = await read(match, request, db, ctx);
  return { response, label: match.route.path };
}

/**
 * Answers one request under `/api/public` (or a row of the table). `requestId` is the router's
 * `context.requestId`, never minted here (ruling H39 (1)); `db` is injectable so a test or the
 * keep-warm job can pass its own client (F25 e).
 */
export async function handlePublic(
  request: Request,
  requestId: string,
  db?: Db,
  wait: WaitUntil = waitUntilOf(request),
): Promise<Response> {
  const started = Date.now();
  const { pathname } = new URL(request.url);
  const ipHash = await ipHashOf(request);
  let response: Response;
  let route = pathname;
  try {
    const ctx: PublicCtx = { requestId, ipHash, turnstileOk: false, wait, env };
    const handled = await dispatch(request, db ?? getDb(), ctx, pathname);
    response = handled.response;
    route = handled.label;
  } catch (error) {
    if (error instanceof ZodError) {
      response = toErrorResponse(fromZod(error), requestId);
    } else {
      if (!(error instanceof AppError)) {
        logLine("error", "unhandled_error", { requestId, route });
        wait(captureException(error, { requestId, route, ...sentryOptions() }));
      }
      response = toErrorResponse(error, requestId);
    }
  }
  const out = new Response(response.body, response);
  out.headers.set("x-request-id", requestId);
  if (!out.headers.has("x-mop-cache")) out.headers.set("x-mop-cache", "bypass");
  for (const failure of drainStaleReports()) {
    wait(
      captureException(failure, { requestId, route, ...sentryOptions() }).catch(() => {
        logLine("warn", "stale_report_failed", { requestId });
      }),
    );
  }
  logRequest({ requestId, route, status: out.status, started, ipHash });
  return out;
}
