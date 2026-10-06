import { createServerClient, parseCookieHeader, serializeCookieHeader } from "@supabase/ssr";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import {
  createLocalJWKSet,
  decodeJwt,
  errors as joseErrors,
  jwtVerify,
  type FlattenedJWSInput,
  type JSONWebKeySet,
  type JWSHeaderParameters,
} from "jose";
import { z } from "zod";
import type { Database } from "../../db/index.ts";
import { env } from "./env.ts";
import { AppError } from "./errors.ts";
import { logLine } from "./log.ts";

// The admin session (invariant 17 (b), E14, F25 i). The access token in the Supabase cookie is verified here
// against the project's ES256 key, taken from its JWKS once and held in module memory, so a request makes
// no call to Supabase Auth. Only an expired token is refreshed over the network (about hourly), and only
// a sign-in, a sign-out or that refresh writes cookies.

const JWKS_TIMEOUT_MS = 2000;
// Each call to Supabase Auth (refresh, verify, send, sign-out) is aborted after this long (R32, API-03).
const AUTH_TIMEOUT_MS = 5000;
// An unknown `kid` refetches the key set, at most this often, so a forged header cannot drive a fetch per request.
const REFETCH_AFTER_MS = 30_000;
const COOKIE_OPTIONS = { path: "/", httpOnly: true, secure: true, sameSite: "lax" } as const;

/** What a verified access token says about the person who signed in. */
export interface SessionUser {
  userId: string;
  /** The `session_id` claim: the same across refreshes of one sign-in (API-05). */
  sessionId: string;
  /** Milliseconds since the epoch of the newest `amr` entry, the sign-in instant (invariant 11). */
  signedInAt: number;
}

const claimsSchema = z.object({
  sub: z.string().uuid(),
  session_id: z.string().min(1),
  amr: z.array(z.object({ method: z.string(), timestamp: z.number() })).min(1),
});

const jwksSchema = z.object({
  keys: z.array(z.object({ kty: z.string() }).passthrough()),
});

const unavailable = () =>
  new AppError(
    "auth_unavailable",
    undefined,
    "Sign-in is unavailable at the moment. Please try again shortly.",
  );

function project(): { url: string; key: string } {
  const { SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: key } = env;
  if (url === undefined || key === undefined) throw unavailable();
  return { url, key };
}

let keySet: JSONWebKeySet | undefined;
let fetchedAt = Number.NEGATIVE_INFINITY;

async function fetchKeys(url: string, now: number): Promise<JSONWebKeySet> {
  let response: Response;
  try {
    response = await fetch(`${url}/auth/v1/.well-known/jwks.json`, {
      signal: AbortSignal.timeout(JWKS_TIMEOUT_MS),
    });
  } catch (error) {
    logLine("warn", "jwks_fetch_failed", { reason: error instanceof Error ? error.name : "fetch" });
    throw unavailable();
  }
  const parsed = response.ok ? jwksSchema.safeParse(await response.json()) : undefined;
  if (parsed?.success !== true) {
    logLine("warn", "jwks_fetch_failed", { status: response.status });
    throw unavailable();
  }
  const keys: JSONWebKeySet = parsed.data;
  keySet = keys;
  fetchedAt = now;
  return keys;
}

function keyResolver(url: string, now: number) {
  return async (header: JWSHeaderParameters, token: FlattenedJWSInput) => {
    const known = keySet ?? (await fetchKeys(url, now));
    try {
      return await createLocalJWKSet(known)(header, token);
    } catch (error) {
      const stale =
        error instanceof joseErrors.JWKSNoMatchingKey && now - fetchedAt >= REFETCH_AFTER_MS;
      if (!stale) throw error;
      return createLocalJWKSet(await fetchKeys(url, now))(header, token);
    }
  };
}

/** The verified user of an access token, or null for a token that fails any check. */
async function verifyAccessToken(token: string, now: number): Promise<SessionUser | null> {
  const { url } = project();
  let payload: unknown;
  try {
    ({ payload } = await jwtVerify(token, keyResolver(url, now), {
      algorithms: ["ES256"],
      issuer: `${url}/auth/v1`,
      audience: "authenticated",
      currentDate: new Date(now),
    }));
  } catch (error) {
    if (error instanceof AppError) throw error;
    return null;
  }
  const claims = claimsSchema.safeParse(payload);
  if (!claims.success) return null;
  const { sub, session_id: sessionId, amr } = claims.data;
  return {
    userId: sub,
    sessionId,
    signedInAt: Math.max(...amr.map((entry) => entry.timestamp)) * 1000,
  };
}

/** The `session_id` claim of a token Supabase Auth has just issued over TLS, read without a key. */
export function sessionIdOf(accessToken: string): string {
  return claimsSchema.parse(decodeJwt(accessToken)).session_id;
}

// The `Set-Cookie` values a request's auth client wrote, which `defineAdminRoute` adds to its response.
const issued = new WeakMap<Request, string[]>();

/** Removes and returns the cookies written for `request`. */
export function takeIssuedCookies(request: Request): string[] {
  const cookies = issued.get(request) ?? [];
  issued.delete(request);
  return cookies;
}

// `typeof fetch` also lists Bun's `preconnect`; the Worker never calls it.
const authFetch: typeof fetch = Object.assign(
  (input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> =>
    fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(AUTH_TIMEOUT_MS) }),
  { preconnect: () => undefined },
);

/**
 * The `@supabase/ssr` client of one request: it reads the session cookies of `request` and records the
 * cookies it writes (sign-in, refresh, sign-out) for `takeIssuedCookies`.
 */
export function authClient(request: Request) {
  const { url, key } = project();
  return createServerClient<Database>(url, key, {
    cookieOptions: COOKIE_OPTIONS,
    global: { fetch: authFetch },
    cookies: {
      encode: "tokens-only",
      getAll: () => parseCookieHeader(request.headers.get("cookie") ?? ""),
      setAll: (cookies) => {
        const written = cookies.map(({ name, value, options }) =>
          serializeCookieHeader(name, value, options),
        );
        issued.set(request, [...(issued.get(request) ?? []), ...written]);
      },
    },
  });
}

function hasSessionCookie(request: Request, url: string): boolean {
  const name = `sb-${new URL(url).hostname.split(".")[0] ?? ""}-auth-token`;
  return parseCookieHeader(request.headers.get("cookie") ?? "").some((cookie) =>
    cookie.name.startsWith(name),
  );
}

/** The signed-in user of `request`, or null. An Auth outage answers 503, never 401 (API-03). */
export async function getSessionUser(
  request: Request,
  now = Date.now(),
): Promise<SessionUser | null> {
  const { url } = project();
  if (!hasSessionCookie(request, url)) return null;
  const { data, error } = await authClient(request).auth.getSession();
  if (error !== null && isAuthRetryableFetchError(error)) throw unavailable();
  const token = data.session?.access_token;
  return token === undefined ? null : verifyAccessToken(token, now);
}
