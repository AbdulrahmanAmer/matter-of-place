import "../fixtures/worker-env";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  fakeAuth,
  rolesDb,
  SITE,
  sessionCookie,
  signer,
  stubAuthEnv,
  type Signer,
} from "../fixtures/supabase-auth";

// Invariant 11, GS-02: a session lasts 12 hours from sign-in, and `team` and `settings` need a sign-in in
// the last 15 minutes. Run through `defineAdminRoute` with the real guards, as every admin route does.

const NOW = Date.parse("2026-10-05T21:00:00Z");
const HOUR = 3_600_000;

async function load(key: Signer) {
  stubAuthEnv();
  fakeAuth([key.jwk]);
  vi.resetModules();
  const { defineAdminRoute } = await import("../../src/server/lib/admin-route");
  const { setDbForTests } = await import("../../src/server/lib/db");
  setDbForTests(rolesDb([{ role: "admin", disabled: false }]));
  const handler = vi.fn(() => Promise.resolve([]));
  const route = (action: "submissions.list" | "team.users_list") =>
    defineAdminRoute({ method: "GET", action, input: z.object({}), handler });
  const send = async (action: "submissions.list" | "team.users_list", signedInAt: number) => {
    const response = await route(action)({
      request: new Request(`${SITE}/api/admin/x`, {
        headers: {
          cookie: sessionCookie(await key.token({ now: Date.now(), signedInAt }), Date.now()),
        },
      }),
      context: { requestId: "r1" },
    });
    const body: unknown = await response.json();
    return { status: response.status, body };
  };
  return { send, handler };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("session policy", () => {
  it("answers a session signed in 13 hours ago 401 session_expired, and one of 11 hours 200", async () => {
    const { send, handler } = await load(await signer("kid-a"));
    expect(await send("submissions.list", NOW - 13 * HOUR)).toMatchObject({
      status: 401,
      body: { error: { code: "session_expired" } },
    });
    expect(handler).not.toHaveBeenCalled();
    expect((await send("submissions.list", NOW - 11 * HOUR)).status).toBe(200);
  });

  it("answers a team call 20 minutes after sign-in 401 reauth_required, and 10 minutes after 200", async () => {
    const { send } = await load(await signer("kid-a"));
    expect(await send("team.users_list", NOW - 20 * 60_000)).toMatchObject({
      status: 401,
      body: { error: { code: "reauth_required" } },
    });
    expect((await send("team.users_list", NOW - 10 * 60_000)).status).toBe(200);
    expect((await send("submissions.list", NOW - 20 * 60_000)).status).toBe(200);
  });
});
