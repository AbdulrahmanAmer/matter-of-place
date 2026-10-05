import "../fixtures/worker-env";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  authApiCalls,
  fakeAuth,
  rolesDb,
  SITE,
  sessionCookie,
  signer,
  stubAuthEnv,
} from "../fixtures/supabase-auth";

// Invariant 17 (b), F25 i, API-03: the admin session is verified in the Worker against the project's ES256
// key, so a signed-in request makes no call to Supabase Auth; only the key set is fetched, once.

async function load() {
  stubAuthEnv();
  vi.resetModules();
  const { defineAdminRoute } = await import("../../src/server/lib/admin-route");
  const { setDbForTests } = await import("../../src/server/lib/db");
  setDbForTests(rolesDb([{ role: "managing_editor", disabled: false }]));
  const route = defineAdminRoute({
    method: "GET",
    action: "me",
    input: z.object({}),
    handler: () => Promise.resolve({ ok: true }),
  });
  return (token: string) =>
    route({
      request: new Request(`${SITE}/api/admin/me`, {
        headers: { cookie: sessionCookie(token, Date.now()) },
      }),
      context: { requestId: "r1" },
    });
}

const codeOf = async (response: Response): Promise<unknown> =>
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

describe("the admin session", () => {
  // A loaded laptop queues Web Crypto work: 1,000 verifications took 39 s under 100 % CPU.
  it(
    "serves 1,000 requests with a valid token with no call to Supabase Auth and one key fetch",
    {
      timeout: 180_000,
    },
    async () => {
      const key = await signer("kid-a");
      const auth = fakeAuth([key.jwk]);
      const send = await load();
      const token = await key.token({ now: Date.now() });
      const statuses = new Set<number>();
      for (let index = 0; index < 1000; index += 1) statuses.add((await send(token)).status);
      expect(statuses).toEqual(new Set([200]));
      expect(authApiCalls(auth)).toEqual([]);
      expect(auth.calls).toHaveLength(1);
    },
  );

  it("refetches the key set once for an unknown kid, and not again inside 30 seconds", async () => {
    const first = await signer("kid-a");
    const second = await signer("kid-b");
    const stranger = await signer("kid-c");
    const auth = fakeAuth([first.jwk]);
    const send = await load();
    expect((await send(await first.token({ now: Date.now() }))).status).toBe(200);
    auth.keys = [first.jwk, second.jwk];
    vi.setSystemTime(Date.now() + 31_000);
    expect((await send(await second.token({ now: Date.now() }))).status).toBe(200);
    expect((await send(await second.token({ now: Date.now() }))).status).toBe(200);
    expect(auth.calls).toHaveLength(2);
    const refused = await send(await stranger.token({ now: Date.now() }));
    expect(refused.status).toBe(401);
    expect(auth.calls).toHaveLength(2);
  });

  it("answers a token with a bad signature 401", async () => {
    const key = await signer("kid-a");
    fakeAuth([key.jwk]);
    const send = await load();
    const token = await key.token({ now: Date.now() });
    const tampered = `${token.slice(0, -4)}${token.endsWith("AAAA") ? "BBBB" : "AAAA"}`;
    const response = await send(tampered);
    expect(response.status).toBe(401);
    expect(await codeOf(response)).toBe("unauthorized");
  });

  it("answers 503 auth_unavailable, not 401, when the key set cannot be fetched and none is cached", async () => {
    const key = await signer("kid-a");
    const auth = fakeAuth([key.jwk]);
    auth.jwksStatus = 500;
    const send = await load();
    const response = await send(await key.token({ now: Date.now() }));
    expect(response.status).toBe(503);
    expect(await codeOf(response)).toBe("auth_unavailable");
  });
});
