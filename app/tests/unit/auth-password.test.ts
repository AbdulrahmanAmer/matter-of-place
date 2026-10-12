import "../fixtures/worker-env";
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CSRF_KEY,
  fakeAuth,
  rolesDb,
  routeHandler,
  SESSION_COOKIE,
  SESSION_ID,
  SITE,
  sessionBody,
  setCookies,
  signer,
  stubAuthEnv,
} from "../fixtures/supabase-auth";

// Operator, 2026-10-12 ("give me a password"): the password path of the sign-in screen. It passes the same bot check
// and hourly limits as the link, answers one 401 for every wrong pair, sets the session and `mop_csrf` for a person
// with a role, and sends the browser only to a page inside `/admin`.

const SITEVERIFY = "challenges.cloudflare.com";

async function passwordRoute({
  disabled = false,
  rightPassword = "correct horse battery",
  turnstile = true,
} = {}) {
  const key = await signer("kid-a");
  const token = await key.token({ now: Date.now() });
  const auth = fakeAuth([key.jwk], (url, init) => {
    if (url.hostname === SITEVERIFY) return Response.json({ success: turnstile });
    if (url.pathname === "/auth/v1/token") {
      const body: unknown = typeof init?.body === "string" ? JSON.parse(init.body) : null;
      const given =
        typeof body === "object" && body !== null && "password" in body ? body.password : null;
      return given === rightPassword
        ? Response.json(sessionBody(token, Date.now()))
        : Response.json(
            { error: "invalid_grant", error_description: "Invalid login credentials" },
            { status: 400 },
          );
    }
    if (url.pathname === "/auth/v1/logout") return new Response(null, { status: 204 });
    return undefined;
  });
  stubAuthEnv();
  vi.resetModules();
  const { setDbForTests } = await import("../../src/server/lib/db");
  setDbForTests(
    rolesDb([{ role: "managing_editor", disabled }], {
      rpc: { rate_limit_check: () => [{ allowed: true, retry_after: 0 }] },
    }),
  );
  const handler = routeHandler(await import("../../src/routes/api/admin/auth.password"), "POST");
  const post = (
    body: { email: string; password: string; next?: string },
    headers: Record<string, string> = {},
  ) =>
    handler({
      request: new Request(`${SITE}/api/admin/auth/password`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: SITE,
          "cf-connecting-ip": "203.0.113.9",
          "x-turnstile-token": "token",
          ...headers,
        },
        body: JSON.stringify(body),
      }),
      context: { requestId: "r1" },
    });
  return { auth, post };
}

const sessionCookies = (response: Response) =>
  setCookies(response).filter(
    (cookie) => cookie.startsWith(SESSION_COOKIE) && !/Max-Age=0/i.test(cookie),
  );

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.parse("2026-10-12T09:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("POST auth/password", () => {
  it("signs in with the right pair: the session cookie, mop_csrf, and next inside /admin", async () => {
    const { post } = await passwordRoute();
    const response = await post({
      email: "Editor@Example.test",
      password: "correct horse battery",
      next: "/admin/requests",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ next: "/admin/requests" });
    expect(sessionCookies(response)).toHaveLength(1);
    const csrf = createHmac("sha256", CSRF_KEY).update(SESSION_ID).digest("base64url");
    expect(setCookies(response)).toContain(
      `mop_csrf=${csrf}; Path=/; Secure; SameSite=Lax; Max-Age=43200`,
    );
  });

  it("answers 401 unauthorized for a wrong password and sets no session", async () => {
    const { post } = await passwordRoute();
    const response = await post({ email: "editor@example.test", password: "wrong" });
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: { code: "unauthorized", message: "That email and password do not match." },
    });
    expect(sessionCookies(response)).toEqual([]);
  });

  it("sends next outside /admin back to /admin", async () => {
    const { post } = await passwordRoute();
    const response = await post({
      email: "editor@example.test",
      password: "correct horse battery",
      next: "https://evil.example",
    });
    expect(await response.json()).toEqual({ next: "/admin" });
  });

  it("refuses a foreign Origin before asking Supabase Auth", async () => {
    const { auth, post } = await passwordRoute();
    const response = await post(
      { email: "editor@example.test", password: "correct horse battery" },
      { origin: "https://evil.example" },
    );
    expect(response.status).toBe(403);
    expect(auth.calls).toEqual([]);
  });

  it("refuses when Turnstile fails, without trying the password", async () => {
    const { auth, post } = await passwordRoute({ turnstile: false });
    const response = await post({
      email: "editor@example.test",
      password: "correct horse battery",
    });
    expect(response.status).toBe(429);
    expect(auth.calls.filter((call) => call.url.includes("/auth/v1/token"))).toEqual([]);
  });

  it("signs a disabled account out again and sets no session", async () => {
    const { auth, post } = await passwordRoute({ disabled: true });
    const response = await post({
      email: "editor@example.test",
      password: "correct horse battery",
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: "account_disabled" } });
    expect(sessionCookies(response)).toEqual([]);
    expect(auth.calls.map((call) => new URL(call.url).pathname)).toContain("/auth/v1/logout");
  });
});
