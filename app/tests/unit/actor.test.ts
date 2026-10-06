import "../fixtures/worker-env";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { FakeDb } from "../fixtures/fake-db";
import {
  fakeAuth,
  rolesDb,
  routeHandler,
  SESSION_ID,
  SITE,
  sessionCookie,
  signer,
  stubAuthEnv,
  USER_ID,
} from "../fixtures/supabase-auth";

// Invariant 17 (e): a session actor's roles come from one `user_roles` read per request, disabled rows
// dropped; no enabled row is 401 `account_disabled`. And `GET me` tells the page which environment it is.

async function actorOf(db: FakeDb) {
  const key = await signer("kid-a");
  fakeAuth([key.jwk]);
  stubAuthEnv();
  vi.resetModules();
  const { requireActor } = await import("../../src/server/lib/actor");
  const request = new Request(`${SITE}/api/admin/me`, {
    headers: { cookie: sessionCookie(await key.token({ now: Date.now() }), Date.now()) },
  });
  return requireActor(request, db);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.parse("2026-10-05T09:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("requireActor", () => {
  it("keeps only the enabled role of a user with one enabled and one disabled row, in one read", async () => {
    const db = rolesDb([
      { role: "managing_editor", disabled: false },
      { role: "admin", disabled: true },
    ]);
    const actor = await actorOf(db);
    expect(actor).toEqual({
      userId: USER_ID,
      kind: "human",
      roles: ["managing_editor"],
      scopes: [],
      session: { id: SESSION_ID, signedInAt: Date.parse("2026-10-05T09:00:00Z") },
    });
    expect(db.calls).toEqual([{ kind: "from", name: "user_roles", args: [] }]);
  });

  it("answers a user whose rows are all disabled 401 account_disabled", async () => {
    const db = rolesDb([{ role: "admin", disabled: true }]);
    await expect(actorOf(db)).rejects.toMatchObject({ code: "account_disabled", status: 401 });
  });

  it("answers a request with neither a session nor a key 401", async () => {
    stubAuthEnv();
    vi.resetModules();
    const { requireActor } = await import("../../src/server/lib/actor");
    await expect(
      requireActor(new Request(`${SITE}/api/admin/me`), rolesDb([])),
    ).rejects.toMatchObject({ code: "unauthorized", status: 401 });
  });
});

describe("GET me", () => {
  it("answers the actor, its actions and the environment", async () => {
    const key = await signer("kid-a");
    fakeAuth([key.jwk]);
    stubAuthEnv();
    vi.stubEnv("MOP_ENV", "preview");
    vi.stubEnv("SENTRY_DSN", "https://key@example.test/1");
    vi.resetModules();
    const { setDbForTests } = await import("../../src/server/lib/db");
    setDbForTests(rolesDb([{ role: "commercial", disabled: false }]));
    const me = routeHandler(await import("../../src/routes/api/admin/me"), "GET");
    const response = await me({
      request: new Request(`${SITE}/api/admin/me`, {
        headers: { cookie: sessionCookie(await key.token({ now: Date.now() }), Date.now()) },
      }),
      context: { requestId: "r1" },
    });
    const body = z
      .object({ kind: z.string(), environment: z.string(), actions: z.array(z.string()) })
      .parse(await response.json());
    expect(body).toMatchObject({ kind: "human", environment: "preview" });
    expect(body.actions).toContain("me");
    expect(body.actions).not.toContain("team.users_list");
  });
});
