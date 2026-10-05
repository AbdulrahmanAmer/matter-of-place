import "../fixtures/worker-env";
import { createHmac } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfirmForm } from "../../src/admin/team/ConfirmForm";
import {
  CSRF_KEY,
  fakeAuth,
  rolesDb,
  routeHandler,
  SESSION_COOKIE,
  SESSION_ID,
  SITE,
  sessionBody,
  sessionCookie,
  setCookies,
  signer,
  stubAuthEnv,
} from "../fixtures/supabase-auth";

// Invariant 19, API-01: opening the mailed link spends nothing; the confirm page's POST spends the token
// hash, sets the session and `mop_csrf`, and redirects only inside `/admin`.

async function verifyRoute(disabled = false) {
  const key = await signer("kid-a");
  const token = await key.token({ now: Date.now() });
  const auth = fakeAuth([key.jwk], (url) => {
    if (url.pathname === "/auth/v1/verify") return Response.json(sessionBody(token, Date.now()));
    if (url.pathname === "/auth/v1/logout") return new Response(null, { status: 204 });
    return undefined;
  });
  stubAuthEnv();
  vi.resetModules();
  const { setDbForTests } = await import("../../src/server/lib/db");
  setDbForTests(rolesDb([{ role: "managing_editor", disabled }]));
  const handler = routeHandler(await import("../../src/routes/api/admin/auth.verify"), "POST");
  const post = (next: string, headers: Record<string, string> = {}) =>
    handler({
      request: new Request(`${SITE}/api/admin/auth/verify`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          origin: SITE,
          ...headers,
        },
        body: new URLSearchParams({ token_hash: "hash-1", type: "email", next }).toString(),
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
  vi.setSystemTime(Date.parse("2026-10-05T09:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("the confirm page", () => {
  it("renders one button in a form that posts to verify, and makes no request", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const html = renderToStaticMarkup(
      createElement(ConfirmForm, { tokenHash: "hash-1", type: "invite", next: "/admin/requests" }),
    );
    expect(html).toMatch(/<form [^>]*action="\/api\/admin\/auth\/verify" method="post"/);
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).toContain("Continue to Matter of Place");
    expect(html).toContain('name="token_hash" value="hash-1"');
    expect(html).toContain('name="type" value="invite"');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("POST auth/verify", () => {
  it("sets the session cookies and mop_csrf and redirects 303 to next", async () => {
    const { auth, post } = await verifyRoute();
    const response = await post("/admin/requests");
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/admin/requests");
    const session = sessionCookies(response);
    // Two cookies, not the plan's three: `tokens-only` keeps both tokens in the one session cookie.
    expect(setCookies(response)).toHaveLength(2);
    expect(session).toHaveLength(1);
    for (const cookie of session) expect(cookie).toMatch(/HttpOnly; Secure; SameSite=Lax/);
    const csrf = createHmac("sha256", CSRF_KEY).update(SESSION_ID).digest("base64url");
    expect(setCookies(response)).toContain(
      `mop_csrf=${csrf}; Path=/; Secure; SameSite=Lax; Max-Age=43200`,
    );
    expect(auth.calls.map((call) => new URL(call.url).pathname)).toEqual(["/auth/v1/verify"]);
  });

  it("redirects //evil.example, https://evil.example and /stories to /admin", async () => {
    const { post } = await verifyRoute();
    const locations = [];
    for (const next of ["//evil.example", "https://evil.example", "/stories"]) {
      locations.push((await post(next)).headers.get("location"));
    }
    expect(locations).toEqual(["/admin", "/admin", "/admin"]);
  });

  it("answers a foreign Origin 403 csrf without spending the token", async () => {
    const { auth, post } = await verifyRoute();
    const response = await post("/admin", { origin: "https://evil.example" });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "csrf" } });
    expect(auth.calls).toEqual([]);
  });

  it("sends a user whose rows are all disabled to sign-in with state=disabled and sets no session", async () => {
    const { auth, post } = await verifyRoute(true);
    const response = await post("/admin/requests");
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/admin/sign-in?state=disabled");
    expect(sessionCookies(response)).toEqual([]);
    expect(setCookies(response).filter((cookie) => cookie.startsWith("mop_csrf="))).toEqual([]);
    expect(auth.calls.map((call) => new URL(call.url).pathname)).toEqual([
      "/auth/v1/verify",
      "/auth/v1/logout",
    ]);
  });
});

describe("POST auth/sign-out", () => {
  it("ends the session and expires the session cookie and mop_csrf", async () => {
    const key = await signer("kid-a");
    const token = await key.token({ now: Date.now() });
    const auth = fakeAuth([key.jwk], (url) =>
      url.pathname === "/auth/v1/logout" ? new Response(null, { status: 204 }) : undefined,
    );
    stubAuthEnv();
    vi.resetModules();
    const { setDbForTests } = await import("../../src/server/lib/db");
    setDbForTests(rolesDb([{ role: "managing_editor", disabled: false }]));
    const signOut = routeHandler(await import("../../src/routes/api/admin/auth.sign-out"), "POST");
    const csrf = createHmac("sha256", CSRF_KEY).update(SESSION_ID).digest("base64url");
    const response = await signOut({
      request: new Request(`${SITE}/api/admin/auth/sign-out`, {
        method: "POST",
        headers: {
          cookie: `${sessionCookie(token, Date.now())}; mop_csrf=${csrf}`,
          "x-mop-csrf": csrf,
        },
      }),
      context: { requestId: "r1" },
    });
    expect(response.status).toBe(204);
    const expired = setCookies(response).filter((cookie) => /Max-Age=0/i.test(cookie));
    expect(expired.map((cookie) => cookie.split("=")[0])).toEqual(
      expect.arrayContaining([SESSION_COOKIE, "mop_csrf"]),
    );
    expect(auth.calls.map((call) => new URL(call.url).pathname)).toContain("/auth/v1/logout");
  });
});
