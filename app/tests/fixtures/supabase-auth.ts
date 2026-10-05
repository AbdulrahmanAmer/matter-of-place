// A stand-in for the Supabase project in unit tests of the admin sign-in (B7 step 2): a throwaway ES256 key
// set, access tokens signed with it, the session cookie `@supabase/ssr` reads, and a fake `fetch` that
// serves the JWKS and the Auth endpoints and records every call. No real network, no real credential.
import { stringToBase64URL } from "@supabase/ssr";
import { exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import { vi } from "vitest";
import type { Database } from "../../src/db";
import { fakeDb, type FakeDb, type FakeDbOptions } from "./fake-db";

export const PROJECT_URL = "https://unittestproject.supabase.co";
export const SESSION_COOKIE = "sb-unittestproject-auth-token";
export const CSRF_KEY = "unit-test-csrf-key";
export const SITE = "https://admin.example.test";
export const USER_ID = "00000000-0000-4000-8000-0000000000a1";
export const SESSION_ID = "00000000-0000-4000-8000-0000000000b1";

/** The Worker variables the admin reads; call before the dynamic import of any module that reads `env.ts` (G-300). */
export function stubAuthEnv(): void {
  vi.stubEnv("SUPABASE_URL", PROJECT_URL);
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "unit-test-service-role");
  vi.stubEnv("CSRF_SECRET", CSRF_KEY);
  vi.stubEnv("TURNSTILE_SECRET", "1x0000000000000000000000000000000AA");
}

export interface Signer {
  jwk: JWK;
  /** `now` is the caller's clock (a fake one in these tests); the token is valid for an hour from it. */
  token: (claims: { now: number; sessionId?: string; signedInAt?: number }) => Promise<string>;
}

export async function signer(kid: string): Promise<Signer> {
  const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
  const jwk = { ...(await exportJWK(publicKey)), kid, alg: "ES256", use: "sig" };
  return {
    jwk,
    token: ({ now, sessionId = SESSION_ID, signedInAt = now }) =>
      new SignJWT({
        session_id: sessionId,
        role: "authenticated",
        aal: "aal1",
        amr: [{ method: "otp", timestamp: Math.floor(signedInAt / 1000) }],
      })
        .setProtectedHeader({ alg: "ES256", kid, typ: "JWT" })
        .setSubject(USER_ID)
        .setIssuer(`${PROJECT_URL}/auth/v1`)
        .setAudience("authenticated")
        .setIssuedAt(Math.floor(now / 1000))
        .setExpirationTime(Math.floor((now + 3_600_000) / 1000))
        .sign(privateKey),
  };
}

/** The Supabase session JSON an Auth endpoint answers and the cookie stores. */
export function sessionBody(accessToken: string, now: number) {
  return {
    access_token: accessToken,
    refresh_token: "unit-test-refresh",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(now / 1000) + 3600,
    user: {
      id: USER_ID,
      aud: "authenticated",
      role: "authenticated",
      email: "editor@example.test",
    },
  };
}

/** The `Cookie` header of a browser holding the session of `accessToken`, as `@supabase/ssr` writes it. */
export function sessionCookie(accessToken: string, now: number): string {
  const { user: _user, ...tokens } = sessionBody(accessToken, now);
  return `${SESSION_COOKIE}=base64-${stringToBase64URL(JSON.stringify(tokens))}`;
}

export interface AuthFake {
  /** Every URL the code fetched, in order. */
  calls: { url: string; init: RequestInit | undefined }[];
  /** The key sets the JWKS answers, replaceable mid-test. */
  keys: JWK[];
  jwksStatus: number;
}

type Answer = (url: URL, init: RequestInit | undefined) => Response | undefined;

/** Installs a global `fetch` that answers the JWKS and whatever `answer` returns; anything else is a test failure. */
export function fakeAuth(keys: JWK[], answer: Answer = () => undefined): AuthFake {
  const fake: AuthFake = { calls: [], keys, jwksStatus: 200 };
  vi.stubGlobal("fetch", (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input);
    fake.calls.push({ url: url.href, init });
    if (url.pathname === "/auth/v1/.well-known/jwks.json") {
      return Promise.resolve(Response.json({ keys: fake.keys }, { status: fake.jwksStatus }));
    }
    const answered = answer(url, init);
    if (answered === undefined) return Promise.reject(new Error(`unexpected fetch ${url.href}`));
    return Promise.resolve(answered);
  });
  return fake;
}

/** Calls to Supabase Auth other than the key set. */
export const authApiCalls = (fake: AuthFake) =>
  fake.calls.filter(
    (call) => call.url.includes("/auth/v1/") && !call.url.endsWith("/.well-known/jwks.json"),
  );

type Role = Database["public"]["Enums"]["app_role"];

/** A fake database whose `user_roles` read answers `rows` for the signed-in user. */
export function rolesDb(
  rows: { role: Role; disabled: boolean }[],
  options: FakeDbOptions = {},
): FakeDb {
  const now = "2026-10-05T09:00:00.000Z";
  return fakeDb({
    ...options,
    tables: {
      ...options.tables,
      user_roles: rows.map(({ role, disabled }, index) => ({
        id: `00000000-0000-4000-8000-00000000000${String(index)}`,
        user_id: USER_ID,
        role,
        actor_kind: "human",
        display_name: null,
        disabled_at: disabled ? now : null,
        created_at: now,
        updated_at: now,
      })),
    },
  });
}

type Handler = (args: {
  request: Request;
  context: { requestId: string };
  params?: Record<string, string>;
}) => Promise<Response>;

const field = (value: unknown, key: string): unknown =>
  (typeof value === "object" || typeof value === "function") && value !== null
    ? Reflect.get(value, key)
    : undefined;

/** The handler a route file exports for `method`, read off the module as TanStack does. */
export function routeHandler(module: unknown, method: string): Handler {
  const handler = field(
    field(field(field(field(module, "Route"), "options"), "server"), "handlers"),
    method,
  );
  if (typeof handler !== "function") throw new Error(`no ${method} handler`);
  return async (args) => {
    const response: unknown = await Reflect.apply(handler, undefined, [args]);
    if (!(response instanceof Response)) throw new Error(`${method} answered no Response`);
    return response;
  };
}

/** The `Set-Cookie` values of a response, one per cookie. */
export const setCookies = (response: Response): string[] => response.headers.getSetCookie();
