import "../fixtures/worker-env";
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  CSRF_KEY,
  fakeAuth,
  rolesDb,
  routeHandler,
  SESSION_ID,
  SITE,
  sessionCookie,
  setCookies,
  signer,
  stubAuthEnv,
  type Signer,
} from "../fixtures/supabase-auth";

// Invariant 11, API-05: a session write echoes the signed token of its own session in `X-MOP-CSRF` and comes
// from this origin; `GET me` puts the cookie back when it is missing or stale; a bearer key is exempt.

const tokenFor = (sessionId: string) =>
  createHmac("sha256", CSRF_KEY).update(sessionId).digest("base64url");

async function load(key: Signer) {
  stubAuthEnv();
  fakeAuth([key.jwk]);
  vi.resetModules();
  const { defineAdminRoute } = await import("../../src/server/lib/admin-route");
  const { setDbForTests } = await import("../../src/server/lib/db");
  setDbForTests(rolesDb([{ role: "managing_editor", disabled: false }]));
  const handler = vi.fn(() => Promise.resolve({ ok: true }));
  const route = defineAdminRoute({
    method: "POST",
    action: "submissions.note",
    input: z.object({}),
    handler,
  });
  const post = (headers: Record<string, string>) =>
    route({
      request: new Request(`${SITE}/api/admin/submissions/x/note`, { method: "POST", headers }),
      context: { requestId: "r1" },
    });
  return { post, handler };
}

const codeOf = async (response: Response): Promise<string> =>
  z.object({ error: z.object({ code: z.string() }) }).parse(await response.json()).error.code;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.parse("2026-10-05T09:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("CSRF on session writes", () => {
  it("answers a POST without X-MOP-CSRF 403 csrf and never reaches the handler", async () => {
    const key = await signer("kid-a");
    const { post, handler } = await load(key);
    const response = await post({
      cookie: sessionCookie(await key.token({ now: Date.now() }), Date.now()),
    });
    expect(response.status).toBe(403);
    expect(await codeOf(response)).toBe("csrf");
    expect(handler).not.toHaveBeenCalled();
  });

  it("answers a header computed for another session_id 403", async () => {
    const key = await signer("kid-a");
    const { post } = await load(key);
    const response = await post({
      cookie: sessionCookie(await key.token({ now: Date.now() }), Date.now()),
      "x-mop-csrf": tokenFor("00000000-0000-4000-8000-0000000000ff"),
    });
    expect(response.status).toBe(403);
  });

  it("passes a refreshed access token that keeps the same session_id", async () => {
    const key = await signer("kid-a");
    const { post } = await load(key);
    const header = { "x-mop-csrf": tokenFor(SESSION_ID) };
    const first = await key.token({ now: Date.now() });
    vi.setSystemTime(Date.now() + 3_600_000);
    const refreshed = await key.token({ now: Date.now(), signedInAt: Date.now() - 3_600_000 });
    expect(refreshed).not.toBe(first);
    expect((await post({ cookie: sessionCookie(refreshed, Date.now()), ...header })).status).toBe(
      200,
    );
  });

  it("answers a foreign Origin 403 even with the right token", async () => {
    const key = await signer("kid-a");
    const { post } = await load(key);
    const response = await post({
      cookie: sessionCookie(await key.token({ now: Date.now() }), Date.now()),
      "x-mop-csrf": tokenFor(SESSION_ID),
      origin: "https://evil.example",
    });
    expect(response.status).toBe(403);
    expect(await codeOf(response)).toBe("csrf");
  });

  it("lets a bearer key write with no token and no cookie", async () => {
    stubAuthEnv();
    vi.resetModules();
    const { verifyCsrf } = await import("../../src/server/lib/csrf");
    const request = new Request(`${SITE}/api/admin/x`, {
      method: "POST",
      headers: { authorization: "Bearer mopk_dev_x", origin: "https://evil.example" },
    });
    const agent = { userId: "a", kind: "agent" as const, roles: [], scopes: [] };
    await expect(verifyCsrf(request, agent, CSRF_KEY)).resolves.toBeUndefined();
  });

  it("answers a session write 503 csrf_secret_missing when the key is unset", async () => {
    stubAuthEnv();
    vi.stubEnv("CSRF_SECRET", "");
    vi.resetModules();
    const { verifyCsrf } = await import("../../src/server/lib/csrf");
    const { env } = await import("../../src/server/lib/env");
    const human = {
      userId: "u",
      kind: "human" as const,
      roles: [],
      scopes: [],
      session: { id: SESSION_ID, signedInAt: Date.now() },
    };
    await expect(
      verifyCsrf(new Request(`${SITE}/x`, { method: "POST" }), human, env.CSRF_SECRET),
    ).rejects.toMatchObject({ code: "csrf_secret_missing", status: 503 });
  });
});

describe("GET me", () => {
  async function me(cookie: string) {
    const route = routeHandler(await import("../../src/routes/api/admin/me"), "GET");
    return route({
      request: new Request(`${SITE}/api/admin/me`, { headers: { cookie } }),
      context: { requestId: "r1" },
    });
  }

  it("sets mop_csrf to the session's token when the request has no such cookie, and not when it matches", async () => {
    const key = await signer("kid-a");
    await load(key);
    const session = sessionCookie(await key.token({ now: Date.now() }), Date.now());
    const missing = await me(session);
    expect(missing.status).toBe(200);
    expect(setCookies(missing)).toEqual([
      `mop_csrf=${tokenFor(SESSION_ID)}; Path=/; Secure; SameSite=Lax; Max-Age=43200`,
    ]);
    const current = await me(`${session}; mop_csrf=${tokenFor(SESSION_ID)}`);
    expect(setCookies(current)).toEqual([]);
    const stale = await me(`${session}; mop_csrf=stale`);
    expect(setCookies(stale)).toHaveLength(1);
  });
});

describe("safeNext", () => {
  it("keeps a path under /admin and refuses //, a scheme, a backslash and paths outside /admin", async () => {
    const { safeNext } = await import("../../src/server/lib/csrf");
    expect(
      [
        "/admin/requests?state=Submitted",
        "/admin",
        "//evil.example",
        "/admin//evil.example",
        "https://evil.example/admin",
        "javascript:alert(1)",
        "/admin\\evil",
        "/admin\t/evil",
        "/stories",
        "/administrator",
        "",
        undefined,
      ].map(safeNext),
    ).toEqual([
      "/admin/requests?state=Submitted",
      "/admin",
      "/admin",
      "/admin",
      "/admin",
      "/admin",
      "/admin",
      "/admin",
      "/admin",
      "/admin",
      "/admin",
      "/admin",
    ]);
  });
});
