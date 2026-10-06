import "../fixtures/worker-env";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { fakeDb } from "../fixtures/fake-db";
import { SITE, stubAuthEnv } from "../fixtures/supabase-auth";

// Invariant 17 (a): every `/api/admin/*` answer is `private, no-store` and varies on both ways of signing
// in, whether it is JSON, a redirect a handler returns, a refusal or a 405.

const ADMIN_HEADERS = { cacheControl: "private, no-store", vary: "Cookie, Authorization" };

const headersOf = (response: Response) => ({
  cacheControl: response.headers.get("cache-control"),
  vary: response.headers.get("vary"),
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("admin responses", () => {
  it("adminJson answers JSON with the admin transport headers", async () => {
    const { adminJson } = await import("../../src/server/lib/admin-response");
    const response = adminJson({ ok: true }, { status: 201 });
    expect(response.status).toBe(201);
    expect(headersOf(response)).toEqual(ADMIN_HEADERS);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("puts them on every answer of an admin route: JSON, a handler's redirect, a 401 and a 405", async () => {
    stubAuthEnv();
    vi.resetModules();
    const { defineAdminRoute } = await import("../../src/server/lib/admin-route");
    const { setDbForTests } = await import("../../src/server/lib/db");
    setDbForTests(fakeDb());
    const open = (handler: () => Promise<unknown>) =>
      defineAdminRoute({
        method: "POST",
        action: "auth.send_link",
        auth: "none",
        input: z.object({}),
        handler,
      });
    const signedIn = defineAdminRoute({
      method: "GET",
      action: "me",
      input: z.object({}),
      handler: () => Promise.resolve({}),
    });
    const call = (route: ReturnType<typeof open>, method: string) =>
      route({
        request: new Request(`${SITE}/api/admin/x`, { method }),
        context: { requestId: "r1" },
      });
    const answers = [
      await call(
        open(() => Promise.resolve({ ok: true })),
        "POST",
      ),
      await call(
        open(() =>
          Promise.resolve(new Response(null, { status: 303, headers: { location: "/admin" } })),
        ),
        "POST",
      ),
      await call(signedIn, "GET"),
      await call(signedIn, "POST"),
    ];
    expect(answers.map((response) => response.status)).toEqual([200, 303, 401, 405]);
    expect(answers.map(headersOf)).toEqual(Array.from({ length: 4 }, () => ADMIN_HEADERS));
  });
});
