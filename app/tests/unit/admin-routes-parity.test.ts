import "../fixtures/worker-env";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  defineAdminRoute,
  type AdminActor,
  type AdminDeps,
} from "../../src/server/lib/admin-route";
import { matrix, type ActionId } from "../../src/server/lib/authz";
import { AppError } from "../../src/server/lib/errors";
import { loadAdminRoutes, routePathOf } from "../fixtures/admin-routes";
import { fakeDb } from "../fixtures/fake-db";

// Invariant 2 and API-02: every admin handler is built by `defineAdminRoute` with an action of the matrix, and
// every matrix action has a route. The wrapper cases use stand-in guards: the real `requireActor`, `verifyCsrf`,
// `assertSessionFresh` and `requireRecentAuth` arrive with step 2 and are tested there.

// Matrix actions with no route file. B7's own pending routes were removed step by step and the last ones came with
// step 15a.
// A literal list, so an action a later slice adds to the matrix without its route turns this test red.
const routesPending: readonly ActionId[] = [
  // B10: reports.export is the browser's print and never gets a route (G22).
  "reports.export",
];

const SIGNED_IN = Date.parse("2026-10-05T09:00:00Z");
const RECENT_MS = 15 * 60_000;

function guards(minutesSinceSignIn: number): AdminDeps {
  const actor: Omit<AdminActor, "requestId"> = {
    userId: "00000000-0000-4000-8000-000000000001",
    kind: "human",
    roles: ["admin", "managing_editor"],
    scopes: [],
  };
  vi.setSystemTime(SIGNED_IN + minutesSinceSignIn * 60_000);
  return {
    db: () => fakeDb(),
    requireActor: () => Promise.resolve(actor),
    verifyCsrf: (request) =>
      request.headers.get("x-mop-csrf") === "token"
        ? Promise.resolve()
        : Promise.reject(new AppError("csrf", undefined, "Refresh the page and try again.")),
    assertSessionFresh: () => undefined,
    requireRecentAuth: (_actor, now) => {
      if (now.getTime() - SIGNED_IN > RECENT_MS) {
        throw new AppError("reauth_required", undefined, "Sign in again to continue.");
      }
    },
  };
}

const call = (
  route: ReturnType<typeof defineAdminRoute>,
  init: RequestInit & { url?: string } = {},
  requestId = "req-12345678",
) =>
  route({
    request: new Request(init.url ?? "https://example.test/api/admin/x", init),
    context: { requestId },
  });

const bodyOf = async (response: Response): Promise<unknown> => response.json();

const json = (body: unknown, headers: Record<string, string> = {}): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json", "x-mop-csrf": "token", ...headers },
  body: JSON.stringify(body),
});

function declineRoute(deps: AdminDeps) {
  const handler = vi.fn(() => Promise.resolve({ ok: true }));
  const route = defineAdminRoute(
    {
      method: "POST",
      action: "submissions.decline",
      input: z.object({ reason: z.string().min(3) }),
      handler,
    },
    deps,
  );
  return { route, handler };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("the admin route registry", () => {
  it("holds only handlers built by defineAdminRoute, each with a matrix action under its own method", async () => {
    const routes = await loadAdminRoutes();
    const actions = new Set<string>(matrix.map((entry) => entry.action));
    const wrong = routes.filter(
      (route) =>
        route.tag === undefined ||
        route.tag.method !== route.method ||
        (route.tag.auth === "session" && !actions.has(route.tag.action)),
    );
    expect(wrong).toEqual([]);
  });

  it("gives every matrix action a route, apart from the ones a later step adds", async () => {
    const routed = new Set((await loadAdminRoutes()).map((route) => route.tag?.action));
    const missing = matrix.filter(
      (entry) => !routed.has(entry.action) && !routesPending.includes(entry.action),
    );
    const stale = routesPending.filter((action) => routed.has(action));
    expect({ missing, stale }).toEqual({ missing: [], stale: [] });
  });

  it("derives each path from the file name as TanStack does", () => {
    expect([
      routePathOf("submissions.$id.decline.ts"),
      routePathOf("properties.index.ts"),
      routePathOf("team/users.$id.roles.ts"),
      routePathOf("auth.send-link.ts"),
      routePathOf("files.report[.]csv.ts"),
    ]).toEqual([
      "/api/admin/submissions/$id/decline",
      "/api/admin/properties",
      "/api/admin/team/users/$id/roles",
      "/api/admin/auth/send-link",
      "/api/admin/files/report.csv",
    ]);
  });
});

describe("defineAdminRoute", () => {
  it("answers 413 payload_too_large above 65,536 bytes, by header and by body", async () => {
    vi.useFakeTimers();
    const { route, handler } = declineRoute(guards(1));
    const declared = await call(route, json({ reason: "fine" }, { "content-length": "65537" }));
    const sent = await call(route, json({ reason: "x".repeat(65_537) }));
    expect([declared.status, sent.status]).toEqual([413, 413]);
    expect(await bodyOf(sent)).toMatchObject({ error: { code: "payload_too_large" } });
    expect(handler).not.toHaveBeenCalled();
  });

  it("answers 400 bad_content_type on a write that is not JSON", async () => {
    vi.useFakeTimers();
    const { route, handler } = declineRoute(guards(1));
    const response = await call(route, {
      method: "POST",
      headers: { "content-type": "text/plain", "x-mop-csrf": "token" },
      body: "reason=fine",
    });
    expect(response.status).toBe(400);
    expect(await bodyOf(response)).toMatchObject({ error: { code: "bad_content_type" } });
    expect(handler).not.toHaveBeenCalled();
  });

  it("answers 400 bad_content_type on an empty write that declares a type other than JSON", async () => {
    vi.useFakeTimers();
    const handler = vi.fn(() => Promise.resolve({ ok: true }));
    const route = defineAdminRoute(
      { method: "POST", action: "submissions.start_review", input: z.object({}), handler },
      guards(1),
    );
    const typed = await call(route, {
      method: "POST",
      headers: { "content-type": "text/plain", "x-mop-csrf": "token" },
    });
    expect(typed.status).toBe(400);
    expect(handler).not.toHaveBeenCalled();
    const bare = await call(route, { method: "POST", headers: { "x-mop-csrf": "token" } });
    expect(bare.status).toBe(200);
  });

  it("answers 403 csrf to a session POST without X-MOP-CSRF and never reaches the handler", async () => {
    vi.useFakeTimers();
    const { route, handler } = declineRoute(guards(1));
    const refused = await call(route, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "fine" }),
    });
    expect(refused.status).toBe(403);
    expect(await bodyOf(refused)).toMatchObject({ error: { code: "csrf" } });
    expect(handler).not.toHaveBeenCalled();
    expect((await call(route, json({ reason: "fine" }))).status).toBe(200);
  });

  it("answers 401 reauth_required on a recentAuth action 20 minutes after sign-in, and not elsewhere", async () => {
    vi.useFakeTimers();
    const handler = vi.fn(() => Promise.resolve([]));
    const deps = guards(20);
    const team = defineAdminRoute(
      { method: "GET", action: "team.users_list", input: z.object({}), handler },
      deps,
    );
    const list = defineAdminRoute(
      { method: "GET", action: "submissions.list", input: z.object({}), handler },
      deps,
    );
    const refused = await call(team);
    expect(refused.status).toBe(401);
    expect(await bodyOf(refused)).toMatchObject({ error: { code: "reauth_required" } });
    expect(handler).not.toHaveBeenCalled();
    expect((await call(list)).status).toBe(200);
  });

  it("answers 422 on a bad body before the handler runs", async () => {
    vi.useFakeTimers();
    const { route, handler } = declineRoute(guards(1));
    const response = await call(route, json({ reason: "no" }));
    expect(response.status).toBe(422);
    expect(await bodyOf(response)).toMatchObject({ error: { code: "validation" } });
    expect(handler).not.toHaveBeenCalled();
  });

  it("answers every error with the router's request id r1 and mints none", async () => {
    vi.useFakeTimers();
    const mint = vi.spyOn(crypto, "randomUUID");
    const { route } = declineRoute(guards(1));
    const response = await call(route, json({ reason: "no" }), "r1");
    expect(await bodyOf(response)).toMatchObject({ error: { requestId: "r1" } });
    expect(response.headers.get("x-request-id")).toBe("r1");
    expect(mint).not.toHaveBeenCalled();
  });

  it("answers a GET sent to a POST handler with 405 method_not_allowed and Allow: POST", async () => {
    vi.useFakeTimers();
    const { route, handler } = declineRoute(guards(1));
    const response = await call(route, { method: "GET" });
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
    expect(await bodyOf(response)).toMatchObject({ error: { code: "method_not_allowed" } });
    expect(handler).not.toHaveBeenCalled();
  });

  it("answers a role the action lacks with 403 forbidden before the handler", async () => {
    vi.useFakeTimers();
    const deps = guards(1);
    const commercial: AdminDeps = {
      ...deps,
      requireActor: () =>
        Promise.resolve({ userId: "u", kind: "human", roles: ["commercial"], scopes: [] }),
    };
    const { route, handler } = declineRoute(commercial);
    const response = await call(route, json({ reason: "fine" }));
    expect(response.status).toBe(403);
    expect(await bodyOf(response)).toMatchObject({ error: { code: "forbidden" } });
    expect(handler).not.toHaveBeenCalled();
  });

  it("answers JSON that no store keeps, and passes a Response the handler returns through", async () => {
    vi.useFakeTimers();
    const ok = await call(declineRoute(guards(1)).route, json({ reason: "fine" }));
    expect(ok.headers.get("cache-control")).toBe("private, no-store");
    expect(await bodyOf(ok)).toEqual({ ok: true });
    const redirect = defineAdminRoute(
      {
        method: "GET",
        action: "me",
        input: z.object({}),
        handler: () =>
          Promise.resolve(new Response(null, { status: 302, headers: { location: "/admin" } })),
      },
      guards(1),
    );
    expect((await call(redirect)).status).toBe(302);
  });

  it("strips a result to its output schema and answers 500 server when the result breaks it", async () => {
    vi.useFakeTimers();
    const output = z.object({ id: z.string() });
    const route = (result: unknown) =>
      defineAdminRoute(
        {
          method: "GET",
          action: "submissions.get",
          input: z.object({}),
          output,
          handler: () => Promise.resolve(result),
        },
        guards(1),
      );
    const kept = await call(route({ id: "a", submitter_email: "kept@example.invalid" }));
    const broken = await call(route({ name: "no id" }));
    expect(await bodyOf(kept)).toEqual({ id: "a" });
    expect(broken.status).toBe(500);
    const body = await bodyOf(broken);
    expect(body).toMatchObject({ error: { code: "server" } });
    expect(JSON.stringify(body)).not.toContain("output schema");
  });

  it("answers 500 server, not 422, when a schema inside the handler fails", async () => {
    vi.useFakeTimers();
    const route = defineAdminRoute(
      {
        method: "GET",
        action: "submissions.get",
        input: z.object({}),
        handler: () => Promise.resolve(z.object({ id: z.string() }).parse({})),
      },
      guards(1),
    );
    const response = await call(route);
    expect(response.status).toBe(500);
    expect(await bodyOf(response)).toMatchObject({ error: { code: "server" } });
  });
});
