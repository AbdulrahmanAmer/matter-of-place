import "../fixtures/worker-env";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { Database } from "../../src/db";
import { fakeDb, type FakeDb } from "../fixtures/fake-db";
import { SITE, stubAuthEnv } from "../fixtures/supabase-auth";

// S38, architecture 6, invariant 3 and API-04: agent keys are stored as a hash, refused when revoked or
// disabled, touched at most once a minute and limited per key and per failing address.

type KeyRow = Database["public"]["Functions"]["agent_key_by_hash"]["Returns"][number];
type Check = { bucket: string; key_hash: string; limit: number; window_seconds: number };

const KEY_ID = "00000000-0000-4000-8000-0000000000c1";
const AGENT_ID = "00000000-0000-4000-8000-0000000000c2";
const NOW = Date.parse("2026-10-05T09:00:00Z");

function keyRow(overrides: Record<string, unknown> = {}): KeyRow {
  // The generated type calls every column non-null; the function answers nulls for a fresh key.
  return z.custom<KeyRow>().parse({
    key_id: KEY_ID,
    user_id: AGENT_ID,
    scopes: ["submissions"],
    revoked_at: null,
    last_used_at: null,
    roles: ["managing_editor"],
    ...overrides,
  });
}

/** `rate_limit_check` as the SQL counts it: a hit is recorded only when every check passes. */
function limits(): (args: { p_checks: unknown }) => { allowed: boolean; retry_after: number }[] {
  const hits = new Map<string, number>();
  const checksSchema = z.array(
    z.object({
      bucket: z.string(),
      key_hash: z.string(),
      limit: z.number(),
      window_seconds: z.number(),
    }),
  );
  return ({ p_checks }) => {
    const checks: Check[] = checksSchema.parse(p_checks);
    const id = (check: Check) =>
      `${check.bucket}|${check.key_hash}|${String(check.window_seconds)}`;
    const over = checks.find((check) => (hits.get(id(check)) ?? 0) >= check.limit);
    if (over !== undefined) return [{ allowed: false, retry_after: 42 }];
    for (const check of checks) hits.set(id(check), (hits.get(id(check)) ?? 0) + 1);
    return [{ allowed: true, retry_after: 0 }];
  };
}

function keysDb(rows: KeyRow[]): FakeDb {
  return fakeDb({
    rpc: {
      agent_key_by_hash: () => rows,
      rate_limit_check: limits(),
      touch_agent_key: () => undefined,
    },
    tables: {
      settings: [
        {
          key: "agent_daily_limits",
          value: { decisions_per_day: 25, publish_per_day: 5, requests_per_day: 2000 },
          updated_at: new Date(NOW).toISOString(),
          updated_by: null,
        },
      ],
    },
  });
}

async function load() {
  stubAuthEnv();
  vi.resetModules();
  return import("../../src/server/lib/agent-keys");
}

const rpcCalls = (db: FakeDb, name: string) => db.calls.filter((call) => call.name === name);
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("agent keys", () => {
  it("makes keys that start with mopk_ and looks them up by their sha256 only", async () => {
    const { generateKey, verifyKey } = await load();
    const key = generateKey("dev");
    expect(key).toMatch(/^mopk_dev_[A-Za-z0-9_-]{43}$/);
    const db = keysDb([keyRow()]);
    const agent = await verifyKey(db, key, "203.0.113.1", NOW);
    expect(agent).toEqual({
      keyId: KEY_ID,
      userId: AGENT_ID,
      roles: ["managing_editor"],
      scopes: ["submissions"],
    });
    const sent = JSON.stringify(rpcCalls(db, "agent_key_by_hash"));
    expect(sent).toContain(sha256(key));
    expect(sent).not.toContain(key);
  });

  it("refuses a revoked key and a key whose agent has no enabled role", async () => {
    const { verifyKey } = await load();
    const revoked = keysDb([keyRow({ revoked_at: new Date(NOW).toISOString() })]);
    const disabled = keysDb([keyRow({ roles: [] })]);
    await expect(verifyKey(revoked, "mopk_dev_x", "203.0.113.2", NOW)).rejects.toMatchObject({
      code: "unauthorized",
      status: 401,
    });
    await expect(verifyKey(disabled, "mopk_dev_x", "203.0.113.2", NOW)).rejects.toMatchObject({
      code: "unauthorized",
    });
  });

  it("writes last_used_at at most once a minute", async () => {
    const { verifyKey } = await load();
    const recent = keysDb([keyRow({ last_used_at: new Date(NOW - 30_000).toISOString() })]);
    const stale = keysDb([keyRow({ last_used_at: new Date(NOW - 120_000).toISOString() })]);
    await verifyKey(recent, "mopk_dev_x", "203.0.113.3", NOW);
    await verifyKey(stale, "mopk_dev_x", "203.0.113.3", NOW);
    expect([
      rpcCalls(recent, "touch_agent_key").length,
      rpcCalls(stale, "touch_agent_key"),
    ]).toEqual([0, [{ kind: "rpc", name: "touch_agent_key", args: [{ p_key_id: KEY_ID }] }]]);
  });

  it("answers the 61st call of one key in a minute 429 rate_limited with Retry-After and no further RPC", async () => {
    stubAuthEnv();
    vi.resetModules();
    const { defineAdminRoute } = await import("../../src/server/lib/admin-route");
    const { setDbForTests } = await import("../../src/server/lib/db");
    const db = keysDb([keyRow({ last_used_at: new Date().toISOString() })]);
    setDbForTests(db);
    const handler = vi.fn(() => Promise.resolve({ ok: true }));
    const route = defineAdminRoute({ method: "GET", action: "me", input: z.object({}), handler });
    const call = () =>
      route({
        request: new Request(`${SITE}/api/admin/me`, {
          headers: { authorization: "Bearer mopk_dev_x", "cf-connecting-ip": "203.0.113.4" },
        }),
        context: { requestId: "r1" },
      });
    for (let index = 0; index < 60; index += 1) expect((await call()).status).toBe(200);
    const before = db.calls.length;
    const refused = await call();
    expect(refused.status).toBe(429);
    expect(refused.headers.get("retry-after")).toBe("42");
    expect(await refused.json()).toMatchObject({ error: { code: "rate_limited" } });
    expect(db.calls.slice(before).map((entry) => entry.name)).toEqual([
      "agent_key_by_hash",
      "rate_limit_check",
    ]);
    expect(handler).toHaveBeenCalledTimes(60);
  });

  it("refuses an address after 20 failed lookups in a minute before looking the key up again", async () => {
    const { verifyKey } = await load();
    const db = keysDb([]);
    for (let index = 0; index < 20; index += 1) {
      await expect(verifyKey(db, "mopk_dev_wrong", "203.0.113.5", NOW)).rejects.toMatchObject({
        code: "unauthorized",
      });
    }
    await expect(verifyKey(db, "mopk_dev_wrong", "203.0.113.5", NOW)).rejects.toMatchObject({
      code: "rate_limited",
      status: 429,
    });
    expect(rpcCalls(db, "agent_key_by_hash")).toHaveLength(20);
    await expect(verifyKey(db, "mopk_dev_wrong", "203.0.113.6", NOW)).rejects.toMatchObject({
      code: "unauthorized",
    });
  });
});
