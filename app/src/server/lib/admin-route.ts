import type { ZodType, ZodTypeDef } from "zod";
import { fromRpcError } from "./admin-errors.ts";
import { authorize, permission, type ActionId, type Principal } from "./authz.ts";
import { getDb, type Db } from "./db.ts";
import { env, sentryOptions } from "./env.ts";
import { AppError, fromZod, toErrorResponse } from "./errors.ts";
import { logLine } from "./log.ts";
import { captureException } from "./sentry.ts";
import { waitUntilOf } from "./wait-until.ts";

// The one wrapper of every `/api/admin/*` handler (invariant 1, API-02, CS-03). It runs, in this
// order: the method, the size cap, the JSON content type of a write, the actor, CSRF on a write, the
// 12 hour session, `authorize`, the recent sign-in the matrix asks for, the Zod parse, the handler.
// Every throw becomes an R09 body through `fromRpcError`.

/** The tag `tests/fixtures/admin-routes.ts` reads off every handler this module builds. */
export const ADMIN_ROUTE = Symbol("ADMIN_ROUTE");

const MAX_BODY_BYTES = 65_536;
const WRITES: readonly string[] = ["POST", "PUT", "PATCH", "DELETE"];
const JSON_TYPE = /^application\/json\s*(?:;|$)/i;

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
type Auth = "session" | "none";
/** The two sign-in routes that run before there is an actor (invariant 19). */
type OpenAction = "auth.send_link" | "auth.verify";

/** A signed-in person or agent key; services pass it on, and `auditContext` reads it. */
export interface AdminActor extends Principal {
  readonly userId: string;
  /** The router's `context.requestId`, set by the wrapper. */
  readonly requestId: string;
}

interface OpenContext {
  db: Db;
  request: Request;
  env: typeof env;
  /** The router's `context.requestId`, never minted here (ruling H39 (1)). */
  requestId: string;
}

interface AdminContext extends OpenContext {
  actor: AdminActor;
}

interface RouteBase<I> {
  method: Method;
  /** Every route parses its input; one with none declares `z.object({})`. */
  input: ZodType<I, ZodTypeDef, unknown>;
  output?: ZodType<unknown, ZodTypeDef, unknown>;
  bodyLimitBytes?: number;
}

interface SessionRoute<I> extends RouteBase<I> {
  auth?: "session";
  action: ActionId;
  /** A `Response` it returns passes through unchanged (a 302, a cookie). */
  handler: (ctx: AdminContext, input: I) => Promise<unknown>;
}

interface OpenRoute<I> extends RouteBase<I> {
  auth: "none";
  action: OpenAction;
  handler: (ctx: OpenContext, input: I) => Promise<unknown>;
}

export interface AdminRouteTag {
  method: Method;
  action: ActionId | OpenAction;
  auth: Auth;
}

interface HandlerArgs {
  request: Request;
  context: { requestId: string };
  params?: Record<string, string>;
}

export type AdminHandler = ((args: HandlerArgs) => Promise<Response>) & {
  [ADMIN_ROUTE]: AdminRouteTag;
};

/** What the wrapper calls outside itself; a test passes its own. */
export interface AdminDeps {
  db: () => Db;
  requireActor: (request: Request, db: Db) => Promise<Omit<AdminActor, "requestId">>;
  /** Bearer actors are exempt inside it. */
  verifyCsrf: (request: Request, actor: AdminActor) => Promise<void>;
  assertSessionFresh: (actor: AdminActor, now: Date) => void;
  requireRecentAuth: (actor: AdminActor, now: Date) => void;
}

const signInFirst = () => new AppError("session_expired", undefined, "Please sign in again.");

// STUB(B7 step 2): requireActor (actor.ts), verifyCsrf (csrf.ts), assertSessionFresh and requireRecentAuth (session-policy.ts)
const pendingDeps: AdminDeps = {
  db: getDb,
  requireActor: () => Promise.reject(signInFirst()),
  verifyCsrf: () => Promise.reject(signInFirst()),
  assertSessionFresh: () => {
    throw signInFirst();
  },
  requireRecentAuth: () => {
    throw signInFirst();
  },
};

// STUB(B7 step 2): adminJson of admin-response.ts
function adminJson(body: unknown, requestId: string): Response {
  return Response.json(body ?? null, {
    headers: { "cache-control": "private, no-store", "x-request-id": requestId },
  });
}

const tooLarge = () =>
  new AppError("payload_too_large", undefined, "This request is larger than allowed.");

/** Only the caller's input is answered 422; a `ZodError` from deeper in the handler is a server fault. */
function parseInput<I>(schema: ZodType<I, ZodTypeDef, unknown>, raw: unknown): I {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw fromZod(parsed.error);
  return parsed.data;
}

/** The raw input: the query of a read, or the JSON object of a write; path parameters win. */
async function readInput(
  request: Request,
  params: Record<string, string>,
  limit: number,
): Promise<unknown> {
  if (!WRITES.includes(request.method)) {
    return { ...Object.fromEntries(new URL(request.url).searchParams), ...params };
  }
  if (Number(request.headers.get("content-length") ?? 0) > limit) throw tooLarge();
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > limit) throw tooLarge();
  if (text === "") return { ...params };
  if (!JSON_TYPE.test(request.headers.get("content-type") ?? "")) {
    throw new AppError("bad_content_type", undefined, "Send this request as JSON.");
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new AppError("bad_request", undefined, "The request body is not valid JSON.");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new AppError("bad_request", undefined, "The request body must be a JSON object.");
  }
  return { ...body, ...params };
}

export function defineAdminRoute<I>(
  def: SessionRoute<I> | OpenRoute<I>,
  deps: AdminDeps = pendingDeps,
): AdminHandler {
  const tag: AdminRouteTag = {
    method: def.method,
    action: def.action,
    auth: def.auth ?? "session",
  };
  const handle = async ({ request, context, params = {} }: HandlerArgs): Promise<Response> => {
    const { requestId } = context;
    if (request.method !== def.method) {
      const refused = toErrorResponse(
        new AppError("method_not_allowed", undefined, "This address does not accept that method."),
        requestId,
      );
      refused.headers.set("allow", def.method);
      return refused;
    }
    try {
      const raw = await readInput(request, params, def.bodyLimitBytes ?? MAX_BODY_BYTES);
      const db = deps.db();
      const base: OpenContext = { db, request, env, requestId };
      let result: unknown;
      if (def.auth === "none") {
        result = await def.handler(base, parseInput(def.input, raw));
      } else {
        const actor: AdminActor = { ...(await deps.requireActor(request, db)), requestId };
        if (WRITES.includes(request.method)) await deps.verifyCsrf(request, actor);
        const now = new Date();
        deps.assertSessionFresh(actor, now);
        authorize(actor, def.action);
        if (permission(def.action).recentAuth) deps.requireRecentAuth(actor, now);
        result = await def.handler({ ...base, actor }, parseInput(def.input, raw));
      }
      if (result instanceof Response) return result;
      if (!def.output) return adminJson(result, requestId);
      // A handler that answers outside its own schema is a server fault (500), not the caller's (422).
      const shaped = def.output.safeParse(result);
      if (!shaped.success) {
        throw new Error(`${def.action} answered outside its output schema`);
      }
      return adminJson(shaped.data, requestId);
    } catch (error) {
      const known = fromRpcError(error);
      if (known.code === "server") {
        logLine("error", "unhandled_error", { requestId, route: def.action });
        waitUntilOf(request)(
          captureException(error, { requestId, route: def.action, ...sentryOptions() }),
        );
      }
      return toErrorResponse(known, requestId);
    }
  };
  return Object.assign(handle, { [ADMIN_ROUTE]: tag });
}
