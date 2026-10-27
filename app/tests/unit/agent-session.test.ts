import "../fixtures/worker-env";
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { Database } from "../../src/db";
import type { FakeDb, FakeDbOptions } from "../fixtures/fake-db";
import {
  agentKeyRow,
  CSRF_KEY,
  fakeAuth,
  meteringRpc,
  rolesDb,
  routeHandler,
  SESSION_ID,
  SITE,
  sessionCookie,
  signer,
  stubAuthEnv,
  USER_ID,
} from "../fixtures/supabase-auth";
import { SUBMISSION_ID } from "./automation/fixtures/entity-rows";

// Ruling H151 (operator, 2026-10-27: Matter signs in to the admin as himself): a browser session of an agent account
// is that agent, with its key's roles and scopes, never a person. An agent account is one whose role rows say agent or
// that has ever held a key; with no live key its session acts on nothing.

type KeyRow = Database["public"]["Tables"]["agent_keys"]["Row"];

const key = (scopes: string[], revoked = false) => agentKeyRow(scopes, { revoked });

const agentDb = (
  keys: KeyRow[],
  kind: "human" | "agent" = "agent",
  rpc: NonNullable<FakeDbOptions["rpc"]> = meteringRpc,
) => rolesDb([{ role: "admin", disabled: false, kind }], { tables: { agent_keys: keys }, rpc });

async function session() {
  const signing = await signer("kid-agent");
  fakeAuth([signing.jwk]);
  stubAuthEnv();
  vi.resetModules();
  return sessionCookie(await signing.token({ now: Date.now() }), Date.now());
}

async function actorOf(db: FakeDb) {
  const cookie = await session();
  const { requireActor } = await import("../../src/server/lib/actor");
  return requireActor(new Request(`${SITE}/api/admin/me`, { headers: { cookie } }), db);
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

describe("a session of an agent account (H151)", () => {
  it("is the agent, with its roles and its live key's scopes, and keeps its cookie session", async () => {
    const actor = await actorOf(agentDb([key(["workforce", "channels"])]));
    expect(actor).toEqual({
      userId: USER_ID,
      kind: "agent",
      roles: ["admin"],
      scopes: ["workforce", "channels"],
      session: { id: SESSION_ID, signedInAt: Date.parse("2026-10-05T09:00:00Z") },
    });
  });

  it("is an agent when only its key says so, though its role rows say person", async () => {
    const actor = await actorOf(agentDb([key(["workforce"])], "human"));
    expect([actor.kind, actor.scopes]).toEqual(["agent", ["workforce"]]);
  });

  it("acts only within the scopes every live key shares, and a revoked key adds none", async () => {
    const actor = await actorOf(
      agentDb([key(["workforce", "channels"]), key(["channels", "media"]), key(["team"], true)]),
    );
    expect(actor.scopes).toEqual(["channels"]);
  });

  it("is refused 401 when its only key is revoked", async () => {
    await expect(actorOf(agentDb([key(["workforce"], true)]))).rejects.toMatchObject({
      code: "account_disabled",
      status: 401,
    });
  });

  it("is refused 401 when the agent account holds no key at all", async () => {
    await expect(actorOf(agentDb([]))).rejects.toMatchObject({
      code: "account_disabled",
      status: 401,
    });
  });

  it("counts against its first live key by id: the key's per-minute bucket, then its last_used_at", async () => {
    const first = "00000000-0000-4000-8000-0000000000c1";
    const second = "00000000-0000-4000-8000-0000000000c2";
    const db = agentDb([
      agentKeyRow(["workforce"], { id: second }),
      agentKeyRow(["workforce"], { id: first }),
    ]);
    await actorOf(db);
    const rpc = db.calls.filter((call) => call.kind === "rpc");
    expect([
      rpc.map((call) => call.name),
      JSON.stringify(rpc[0]?.args).includes(`agent:${first}`),
      rpc[1]?.args,
    ]).toEqual([["rate_limit_check", "touch_agent_key"], true, [{ p_key_id: first }]]);
  });

  it("is refused 429 when its key's per-minute limit is spent, as the key itself would be", async () => {
    const db = agentDb([key(["workforce"])], "agent", {
      rate_limit_check: () => [{ allowed: false, retry_after: 30 }],
    });
    await expect(actorOf(db)).rejects.toMatchObject({ code: "rate_limited", status: 429 });
  });

  it("leaves a person's session a person's, with no scopes", async () => {
    const actor = await actorOf(rolesDb([{ role: "admin", disabled: false }]));
    expect([actor.kind, actor.scopes]).toEqual(["human", []]);
  });
});

describe("what an agent's session may do (H151)", () => {
  // A cold import of a route file and its services can pass the 5 s default under load (P-3450).
  it("answers the me route as an agent, without the person-only actions", async () => {
    const cookie = await session();
    const { setDbForTests } = await import("../../src/server/lib/db");
    setDbForTests(agentDb([key(["submissions", "workforce"])]));
    const me = routeHandler(await import("../../src/routes/api/admin/me"), "GET");
    const response = await me({
      request: new Request(`${SITE}/api/admin/me`, { headers: { cookie } }),
      context: { requestId: "r-agent-me" },
    });
    const body = z
      .object({ kind: z.string(), actions: z.array(z.string()) })
      .parse(await response.json());
    expect(body.kind).toBe("agent");
    expect(body.actions).toContain("me");
    expect(body.actions).not.toContain("submissions.activate");
    expect(body.actions).not.toContain("team.users_list");
  }, 30_000);

  it("refuses a person-only action 403 human_only and calls nothing", async () => {
    const cookie = await session();
    const db = agentDb([key(["submissions"])]);
    const { setDbForTests } = await import("../../src/server/lib/db");
    setDbForTests(db);
    const activate = routeHandler(
      await import("../../src/routes/api/admin/submissions.$id.activate"),
      "POST",
    );
    const response = await activate({
      request: new Request(`${SITE}/api/admin/submissions/${SUBMISSION_ID}/activate`, {
        method: "POST",
        headers: {
          cookie,
          "x-mop-csrf": createHmac("sha256", CSRF_KEY).update(SESSION_ID).digest("base64url"),
        },
      }),
      context: { requestId: "r-agent-activate" },
      params: { id: SUBMISSION_ID },
    });
    const body = z
      .object({ error: z.object({ code: z.string() }) })
      .safeParse(await response.json());
    expect([response.status, body.data?.error.code]).toEqual([403, "human_only"]);
    // Only the key's metering ran (H151 review finding 3); the person-only action never did.
    expect(db.calls.filter((call) => call.kind === "rpc").map((call) => call.name)).toEqual([
      "rate_limit_check",
      "touch_agent_key",
    ]);
  }, 30_000);

  it("still needs the CSRF token on a write, as every cookie session does", async () => {
    const cookie = await session();
    const { setDbForTests } = await import("../../src/server/lib/db");
    setDbForTests(agentDb([key(["submissions"])]));
    const activate = routeHandler(
      await import("../../src/routes/api/admin/submissions.$id.activate"),
      "POST",
    );
    const response = await activate({
      request: new Request(`${SITE}/api/admin/submissions/${SUBMISSION_ID}/activate`, {
        method: "POST",
        headers: { cookie },
      }),
      context: { requestId: "r-agent-csrf" },
      params: { id: SUBMISSION_ID },
    });
    const body = z
      .object({ error: z.object({ code: z.string() }) })
      .safeParse(await response.json());
    expect([response.status, body.data?.error.code]).toEqual([403, "csrf"]);
  }, 30_000);
});
