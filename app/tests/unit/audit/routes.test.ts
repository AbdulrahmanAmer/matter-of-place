import "../../fixtures/worker-env";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { Route as health } from "../../../src/routes/api/admin/audit.health";
import { Route as kpis } from "../../../src/routes/api/admin/audit.kpis";
import { Route as notFound } from "../../../src/routes/api/admin/audit.notfound";
import { Route as recordRun } from "../../../src/routes/api/admin/audit.record-run";
import { Route as usage } from "../../../src/routes/api/admin/audit.usage";
import { fakeDb } from "../../fixtures/fake-db";

// B14 invariant 10: every route this slice adds answers through B7's `adminJson`, `Cache-Control: private, no-store`
// and `Vary: Cookie, Authorization`, never a bare response. The service is a stub; the actor is the auditor's key.

const stub = vi.hoisted(() => ({
  getUsage: () => Promise.resolve({ db_bytes: 1 }),
  getHealth: () => Promise.resolve({ retention_stalled: [] }),
  listNotFound: () => Promise.resolve({ items: [] }),
  getKpis: () => Promise.resolve({ current: {}, previous: {} }),
  recordAuditRun: () => Promise.resolve({ last_run_at: "2026-10-10T12:00:00Z" }),
}));

vi.mock("../../../src/server/audit/service", () => stub);
vi.mock("../../../src/server/lib/actor", () => ({
  requireActor: () =>
    Promise.resolve({
      userId: "00000000-0000-4000-8000-0000000000a1",
      kind: "agent",
      roles: ["commercial"],
      scopes: ["audit", "automation"],
    }),
}));
vi.mock("../../../src/server/lib/db", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getDb: () => fakeDb(),
}));

const handlerOf = (route: { options: { server?: { handlers?: unknown } } }, method: string) =>
  z
    .record(z.custom<(args: unknown) => unknown>((value) => typeof value === "function"))
    .parse(route.options.server?.handlers)[method];

async function answer(
  route: { options: { server?: { handlers?: unknown } } },
  method: "GET" | "POST",
  path: string,
): Promise<Response> {
  const handler = handlerOf(route, method);
  const request = new Request(`https://example.test/api/admin/audit/${path}`, {
    method,
    headers: { authorization: "Bearer mopk_test" },
  });
  return z
    .instanceof(Response)
    .parse(await handler?.({ request, context: { requestId: "req-routes-1" } }));
}

describe("the audit routes", () => {
  it.each([
    ["usage", usage, "GET", { db_bytes: 1 }],
    ["health", health, "GET", { retention_stalled: [] }],
    ["notfound", notFound, "GET", { items: [] }],
    ["kpis", kpis, "GET", { current: {}, previous: {} }],
    ["record-run", recordRun, "POST", { last_run_at: "2026-10-10T12:00:00Z" }],
  ] as const)(
    "%s answers the service value with private, no-store",
    async (path, route, method, body) => {
      const response = await answer(route, method, path);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.get("vary")).toBe("Cookie, Authorization");
      expect(await response.json()).toEqual(body);
    },
  );
});
