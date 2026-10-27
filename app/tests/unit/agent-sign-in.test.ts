import "../fixtures/worker-env";
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { Database } from "../../src/db";
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

// Ruling H151, review finding 1: an agent key takes a one-time sign-in token for its own account from the admin, so
// Matter's laptop needs no service role. Only a bearer key may ask; a person and every session are refused; it is
// limited per account and audited before any token exists.

type ByHash = Database["public"]["Functions"]["agent_key_by_hash"]["Returns"][number];

const EMAIL = "agent-matter@matterofplace.invalid";

interface Options {
  /** The hourly sign-in bucket's answer; the key's per-minute bucket always allows. */
  allowed?: boolean;
  audited?: boolean;
  kind?: "human" | "agent";
}

async function call(credential: "key" | "session", options: Options = {}) {
  const { allowed = true, audited = true, kind = "agent" } = options;
  const order: string[] = [];
  const authAdmin = {
    getUserById: vi.fn(() =>
      Promise.resolve({ data: { user: { id: USER_ID, email: EMAIL } }, error: null }),
    ),
    generateLink: vi.fn(() => {
      order.push("generateLink");
      return Promise.resolve({
        data: { properties: { hashed_token: "hashed-token-1" }, user: { id: USER_ID } },
        error: null,
      });
    }),
  };
  const db = Object.assign(
    rolesDb([{ role: "admin", disabled: false, kind }], {
      tables: { agent_keys: kind === "agent" ? [agentKeyRow(["workforce"])] : [] },
      rpc: {
        ...meteringRpc,
        agent_key_by_hash: () => [
          z.custom<ByHash>().parse({
            key_id: "00000000-0000-4000-8000-0000000000e3",
            user_id: USER_ID,
            scopes: ["workforce"],
            revoked_at: null,
            last_used_at: new Date().toISOString(),
            roles: ["admin"],
          }),
        ],
        rate_limit_check: (args) => [
          {
            allowed: allowed || !JSON.stringify(args).includes("agent-sign-in"),
            retry_after: 60,
          },
        ],
        write_audit: () => {
          order.push("write_audit");
          return audited ? 1 : new Error("forbidden");
        },
      },
    }),
    { auth: { admin: authAdmin } },
  );
  const signing = await signer("kid-sign-in");
  fakeAuth([signing.jwk]);
  stubAuthEnv();
  vi.resetModules();
  const { setDbForTests } = await import("../../src/server/lib/db");
  setDbForTests(db);
  const headers: Record<string, string> =
    credential === "key"
      ? { authorization: "Bearer mopk_local_agent", "cf-connecting-ip": "203.0.113.5" }
      : {
          cookie: sessionCookie(await signing.token({ now: Date.now() }), Date.now()),
          "x-mop-csrf": createHmac("sha256", CSRF_KEY).update(SESSION_ID).digest("base64url"),
        };
  const post = routeHandler(await import("../../src/routes/api/admin/auth.agent-sign-in"), "POST");
  const response = await post({
    request: new Request(`${SITE}/api/admin/auth/agent-sign-in`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: "{}",
    }),
    context: { requestId: "r-agent-sign-in" },
    params: {},
  });
  const body: unknown = await response.json();
  return { status: response.status, body, authAdmin, order };
}

const codeOf = (body: unknown) =>
  z.object({ error: z.object({ code: z.string() }) }).safeParse(body).data?.error.code;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.parse("2026-10-05T09:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

// A cold import of the route and its services can pass the 5 s default under load (P-3450).
describe("POST auth/agent-sign-in (H151)", () => {
  it("issues a token for the calling key's own account, audited before the token exists", async () => {
    const { status, body, authAdmin, order } = await call("key");
    expect({
      status,
      body,
      user: authAdmin.getUserById.mock.calls,
      link: authAdmin.generateLink.mock.calls,
      order,
    }).toEqual({
      status: 200,
      body: { token_hash: "hashed-token-1" },
      user: [[USER_ID]],
      link: [[{ type: "magiclink", email: EMAIL }]],
      order: ["write_audit", "generateLink"],
    });
  }, 30_000);

  it("refuses a person's session 403 and issues nothing", async () => {
    const { status, body, authAdmin } = await call("session", { kind: "human" });
    expect([status, codeOf(body), authAdmin.generateLink.mock.calls]).toEqual([
      403,
      "forbidden",
      [],
    ]);
  }, 30_000);

  it("refuses an agent's own browser session 403 and issues nothing", async () => {
    const { status, body, authAdmin } = await call("session");
    expect([status, codeOf(body), authAdmin.generateLink.mock.calls]).toEqual([
      403,
      "forbidden",
      [],
    ]);
  }, 30_000);

  it("refuses 429 once the account's hourly sign-ins are spent, and issues nothing", async () => {
    const { status, body, authAdmin } = await call("key", { allowed: false });
    expect([status, codeOf(body), authAdmin.generateLink.mock.calls]).toEqual([
      429,
      "rate_limited",
      [],
    ]);
  }, 30_000);

  it("issues nothing when the audit row is refused", async () => {
    const { status, authAdmin } = await call("key", { audited: false });
    expect([status === 200, authAdmin.generateLink.mock.calls]).toEqual([false, []]);
  }, 30_000);
});
