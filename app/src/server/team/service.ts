import { parseCookieHeader } from "@supabase/ssr";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import type { z } from "zod";
import type { meSchema, sendLinkInput, verifyInput } from "../../domain/admin-team.ts";
import { enabledRoles } from "../lib/actor.ts";
import { fromRpcError } from "../lib/admin-errors.ts";
import type { AdminActor } from "../lib/admin-route.ts";
import { adminJson } from "../lib/admin-response.ts";
import { authorize, can, matrix } from "../lib/authz.ts";
import {
  CSRF_COOKIE,
  csrfCookie,
  csrfTokenFor,
  expireCsrfCookie,
  safeNext,
  sameOrigin,
} from "../lib/csrf.ts";
import type { Db } from "../lib/db.ts";
import type { env } from "../lib/env.ts";
import { AppError } from "../lib/errors.ts";
import { clientIp, hashKey } from "../lib/ids.ts";
import { logLine } from "../lib/log.ts";
import { checkDb, checkMemory } from "../lib/ratelimit.ts";
import { authClient, sessionIdOf, takeIssuedCookies } from "../lib/session.ts";
import { verifyTurnstile } from "../lib/turnstile.ts";

// Staff sign-in (invariant 19, API-01) and `GET me` (invariants 2 and 11). A sign-in link is mailed only to
// an address that holds an enabled role, and the answer never says which addresses those are.

type WorkerEnv = typeof env;

const SEND_LINK = "auth-send-link";
const HOUR_MS = 3_600_000;
const PER_IP = 5;
const PER_EMAIL = 3;
const SENT = { status: "sent" } as const;

const unavailable = () =>
  new AppError(
    "auth_unavailable",
    undefined,
    "Sign-in is unavailable at the moment. Please try again shortly.",
  );

const seeOther = (location: string) => new Response(null, { status: 303, headers: { location } });

export async function getMe(
  actor: AdminActor,
  request: Request,
  environment: WorkerEnv,
): Promise<Response> {
  authorize(actor, "me");
  const body: z.input<typeof meSchema> = {
    actor: { id: actor.userId },
    kind: actor.kind,
    roles: [...actor.roles],
    scopes: [...actor.scopes],
    actions: matrix.filter((entry) => can(actor, entry.action)).map((entry) => entry.action),
    environment: environment.MOP_ENV,
  };
  const headers = new Headers();
  const key = environment.CSRF_SECRET;
  // The layout calls `me` on every load, so a lost or stale token cookie is put back here (API-05).
  if (actor.session !== undefined && key !== undefined) {
    const token = await csrfTokenFor(actor.session.id, key);
    const cookies = parseCookieHeader(request.headers.get("cookie") ?? "");
    const current = cookies.find((cookie) => cookie.name === CSRF_COOKIE)?.value;
    if (current !== token) headers.append("set-cookie", csrfCookie(token));
  }
  return adminJson(body, { headers });
}

/** Why a link is not sent, before the address is even looked up; null when every check passes. */
async function refusal(
  db: Db,
  request: Request,
  environment: WorkerEnv,
  email: string,
): Promise<string | null> {
  const ip = clientIp(request);
  const turnstile = await verifyTurnstile(
    request.headers.get("x-turnstile-token"),
    ip,
    environment,
    SEND_LINK,
  );
  if (turnstile === "fail") return "turnstile";
  if (turnstile === "unreachable") logLine("warn", "turnstile_unreachable", { route: SEND_LINK });
  if (!checkMemory(`${SEND_LINK}:ip`, ip, PER_IP, HOUR_MS).ok) return "memory";
  const salt = environment.RATE_LIMIT_SALT;
  const limits = await checkDb(db, [
    {
      bucket: `${SEND_LINK}:ip`,
      keyHash: await hashKey(salt, ip),
      limit: PER_IP,
      windowSeconds: 3600,
    },
    {
      bucket: `${SEND_LINK}:email`,
      keyHash: await hashKey(salt, email),
      limit: PER_EMAIL,
      windowSeconds: 3600,
    },
  ]);
  return limits.ok ? null : "limit";
}

/** Always answers `sent`: a refusal, an unknown address and a mail failure look the same from outside. */
export async function sendSignInLink(
  db: Db,
  request: Request,
  environment: WorkerEnv,
  input: z.output<typeof sendLinkInput>,
): Promise<typeof SENT> {
  const reason = await refusal(db, request, environment, input.email);
  if (reason !== null) {
    logLine("warn", "send_link_limited", { reason });
    return SENT;
  }
  const staff = await db.rpc("staff_can_sign_in", { p_email: input.email });
  if (staff.error !== null) throw fromRpcError(staff.error);
  if (!staff.data) return SENT;
  // No `emailRedirectTo`: B5's template builds the token-hash link to the confirm page itself.
  const { error } = await authClient(request).auth.signInWithOtp({
    email: input.email,
    options: { shouldCreateUser: false },
  });
  if (error !== null) logLine("warn", "auth_send_failed", { status: error.status ?? 0 });
  return SENT;
}

/** The confirm page's POST: spends the token hash, checks the roles once and sets the session cookies. */
export async function verifySignIn(
  db: Db,
  request: Request,
  environment: WorkerEnv,
  input: z.output<typeof verifyInput>,
): Promise<Response> {
  if (!sameOrigin(request)) {
    throw new AppError("csrf", undefined, "Please open the sign-in link again.");
  }
  const client = authClient(request);
  const { data, error } = await client.auth.verifyOtp({
    type: input.type,
    token_hash: input.token_hash,
  });
  if (error !== null && isAuthRetryableFetchError(error)) throw unavailable();
  const session = data.session;
  if (session === null) return seeOther("/admin/sign-in?state=expired");
  const roles = await enabledRoles(db, session.user.id);
  if (roles.length === 0) {
    await client.auth.signOut();
    // The session is signed out again, so none of its cookies leave the Worker.
    takeIssuedCookies(request);
    return seeOther("/admin/sign-in?state=disabled");
  }
  const response = seeOther(safeNext(input.next));
  const key = environment.CSRF_SECRET;
  if (key !== undefined) {
    const token = await csrfTokenFor(sessionIdOf(session.access_token), key);
    response.headers.append("set-cookie", csrfCookie(token));
  }
  return response;
}

/** Ends the session at Supabase Auth and expires its cookies and `mop_csrf`. */
export async function signOut(actor: AdminActor, request: Request): Promise<Response> {
  authorize(actor, "me");
  const { error } = await authClient(request).auth.signOut();
  if (error !== null && isAuthRetryableFetchError(error)) throw unavailable();
  const response = new Response(null, { status: 204 });
  response.headers.append("set-cookie", expireCsrfCookie());
  return response;
}
