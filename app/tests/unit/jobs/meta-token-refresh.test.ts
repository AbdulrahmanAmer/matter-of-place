// B8 step 8a: the daily Meta token check (GS-01, INT-06, G13, G21). Graph is a fetch spy; the database is B3's fakeDb
// with the settings read, the Vault read, meta_token_record and enqueue_job.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { Json } from "../../../src/db";
import {
  META_REQUIRED_SCOPES,
  metaTokenRefresh,
} from "../../../src/server/jobs/system/meta-token-refresh";
import type { RunnerEnv, StepContext, StepResult } from "../../../src/server/jobs/types";
import { logLine } from "../../../src/server/lib/log";
import { fakeDb, type FakeDb } from "../../fixtures/fake-db";

const NOW = new Date("2026-10-04T04:15:00.000Z");
const DAY_S = 24 * 3600;
const META = { page_id: "1", ig_user_id: "2", graph_version: "v21.0" };
const ENV: RunnerEnv = { META_APP_ID: "app", META_APP_SECRET: "secret" };

const fetchSpy = vi.fn<(input: string, init: RequestInit) => Promise<Response>>();

interface Setup {
  meta?: Json | null;
  vaultToken?: string | null;
  recordAnswer?: string;
}

function setup({ meta = META, vaultToken = "EAAtoken", recordAnswer = "ok" }: Setup = {}): FakeDb {
  const db = fakeDb({
    rpc: {
      get_vault_secret: () => vaultToken ?? "",
      meta_token_record: () => recordAnswer,
      enqueue_job: () => "5b0c7c4e-0000-4000-8000-000000000009",
    },
  });
  return Object.assign(db, {
    from: (name: string) => {
      db.calls.push({ kind: "from", name, args: [] });
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({ data: meta === null ? null : { value: meta }, error: null }),
          }),
        }),
      };
    },
  });
}

function context(db: FakeDb, env: RunnerEnv = ENV): StepContext {
  return {
    db,
    env,
    log: logLine,
    now: NOW,
    signal: new AbortController().signal,
    report: () => Promise.resolve(),
    job: {
      id: "3f2a9c1d-0000-4000-8000-000000000001",
      type: "meta_token_refresh",
      attempts: 0,
      claim: "7d1e0c52-0000-4000-8000-000000000002",
      result: null,
      eventId: null,
    },
  };
}

/** A debug_token answer; `days` from NOW, or 0 for never. */
function debugToken({
  days,
  valid = true,
  type = "PAGE",
  scopes = [...META_REQUIRED_SCOPES],
}: {
  days: number;
  valid?: boolean;
  type?: string;
  scopes?: string[];
}): Response {
  const expires = days === 0 ? 0 : Math.floor(NOW.getTime() / 1000) + days * DAY_S;
  return Response.json({
    data: { type, is_valid: valid, expires_at: expires, data_access_expires_at: 0, scopes },
  });
}

const argsSchema = z
  .object({
    p_token_state: z.string().optional(),
    p_missing_scopes: z.array(z.string()).optional(),
    p_expires_at: z.string().optional(),
    p_new_token: z.string().optional(),
    p_type: z.string().optional(),
    p_idempotency_key: z.string().optional(),
    p_max_attempts: z.number().optional(),
    p_payload: z.unknown().optional(),
  })
  .passthrough();

const rpcCalls = (db: FakeDb, name: string) =>
  db.calls
    .filter((call) => call.kind === "rpc" && call.name === name)
    .map((call) => argsSchema.parse(call.args[0] ?? {}));

const run = (db: FakeDb, env?: RunnerEnv): Promise<StepResult> =>
  metaTokenRefresh.run(context(db, env), {}, {});

beforeEach(() => {
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  fetchSpy.mockReset();
  vi.unstubAllGlobals();
});

describe("meta_token_refresh", () => {
  it("returns skipped not_configured while settings.meta has no ids, and calls nothing", async () => {
    const db = setup({ meta: null });
    expect(await run(db)).toEqual({ status: "done", result: { skipped: "not_configured" } });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("reads the Vault token first and the function secret second", async () => {
    fetchSpy.mockImplementation(() => Promise.resolve(debugToken({ days: 30 })));
    await run(setup({ vaultToken: "EAAvault" }), { ...ENV, META_PAGE_TOKEN: "EAAenv" });
    await run(setup({ vaultToken: null }), { ...ENV, META_PAGE_TOKEN: "EAAenv" });
    const tokens = fetchSpy.mock.calls.map(([url]) => new URL(url).searchParams.get("input_token"));
    expect(tokens).toEqual(["EAAvault", "EAAenv"]);
    expect(fetchSpy.mock.calls[0]?.[0]).toMatch(
      /^https:\/\/graph\.facebook\.com\/v21\.0\/debug_token\?/,
    );
  });

  it("with the token 6 days from expiry and no refresh route, creates exactly one notify_admin job", async () => {
    fetchSpy.mockResolvedValue(debugToken({ days: 6, type: "PAGE" }));
    const db = setup();
    await run(db);
    expect(rpcCalls(db, "enqueue_job")).toEqual([
      {
        p_type: "notify_admin",
        p_idempotency_key: "meta_token_expiry:2026-10-04",
        p_max_attempts: 12,
        p_heavy: false,
        p_payload: {
          params: { headline: "Meta token expires in 6 days" },
          data: {
            summary:
              "The Meta token expires in 6 days and could not be renewed here. Renew it on the channels screen.",
            link_path: "/admin/channels",
          },
        },
      },
    ]);
  });

  it("does nothing more than record a token 8 days from expiry", async () => {
    fetchSpy.mockResolvedValue(debugToken({ days: 8 }));
    const db = setup();
    await run(db);
    expect(rpcCalls(db, "enqueue_job")).toEqual([]);
    expect(rpcCalls(db, "meta_token_record")).toHaveLength(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("with a refresh route, records the renewed token through meta_token_record", async () => {
    fetchSpy
      .mockResolvedValueOnce(debugToken({ days: 6, type: "USER" }))
      .mockResolvedValueOnce(Response.json({ access_token: "EAArenewed", expires_in: 60 * DAY_S }));
    const db = setup();
    const result = await run(db);
    const records = rpcCalls(db, "meta_token_record");
    expect(records.map((call) => call.p_new_token)).toEqual([undefined, "EAArenewed"]);
    expect(records[1]?.p_token_state).toBe("ok");
    expect(fetchSpy.mock.calls[1]?.[0]).toMatch(
      /^https:\/\/graph\.facebook\.com\/v21\.0\/oauth\/access_token\?grant_type=fb_exchange_token&/,
    );
    expect(rpcCalls(db, "enqueue_job")).toEqual([]);
    expect(result).toEqual({ status: "done", result: { token_state: "ok", refreshed: true } });
  });

  it("returns skipped locked when another run holds the token", async () => {
    fetchSpy.mockResolvedValue(debugToken({ days: 6 }));
    const db = setup({ recordAnswer: "locked" });
    expect(await run(db)).toEqual({ status: "done", result: { skipped: "locked" } });
    expect(rpcCalls(db, "enqueue_job")).toEqual([]);
  });

  it("throws on a Graph 500, so the job retries", async () => {
    fetchSpy.mockResolvedValue(new Response("{}", { status: 500 }));
    await expect(run(setup())).rejects.toThrow("Graph answered 500.");
  });

  it("records dead, not never, for is_valid false with expires_at 0, and alerts once (INT-06)", async () => {
    fetchSpy.mockResolvedValue(debugToken({ days: 0, valid: false }));
    const db = setup();
    await run(db);
    const [record] = rpcCalls(db, "meta_token_record");
    expect(record?.p_token_state).toBe("dead");
    expect(record?.p_expires_at).toBeUndefined();
    expect(rpcCalls(db, "enqueue_job").map((call) => call.p_idempotency_key)).toEqual([
      "token_dead:instagram:2026-10-04",
    ]);
  });

  it("records scopes_missing naming a permission the token lacks", async () => {
    fetchSpy.mockResolvedValue(
      debugToken({
        days: 30,
        scopes: META_REQUIRED_SCOPES.filter((scope) => scope !== "instagram_content_publish"),
      }),
    );
    const db = setup();
    await run(db);
    const [record] = rpcCalls(db, "meta_token_record");
    expect([record?.p_token_state, record?.p_missing_scopes]).toEqual([
      "scopes_missing",
      ["instagram_content_publish"],
    ]);
  });

  it("names the five permissions publishing and insights need", () => {
    expect(META_REQUIRED_SCOPES).toEqual([
      "instagram_basic",
      "instagram_content_publish",
      "instagram_manage_insights",
      "pages_show_list",
      "pages_read_engagement",
    ]);
  });
});
