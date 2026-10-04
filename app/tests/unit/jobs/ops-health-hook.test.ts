import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { Json } from "../../../src/db";
import { handleOpsHealth } from "../../../src/server/hooks/ops-health";
import type { FakeDb } from "../../fixtures/fake-db";
import { fakeDb } from "../../fixtures/fake-db";

const TOKEN = "0123456789abcdef".repeat(4);
const ENV = { OPS_HEALTH_TOKEN: TOKEN };

const healthDb = (answer: Json | Error): FakeDb => fakeDb({ rpc: { ops_health: () => answer } });

const rpcCalls = (db: FakeDb) => db.calls.filter((call) => call.kind === "rpc");

async function read(response: Response) {
  return {
    status: response.status,
    body: await response.text(),
    type: response.headers.get("content-type"),
    cache: response.headers.get("cache-control"),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("handleOpsHealth", () => {
  it("answers 200 ok as no-store plain text after one ops_health RPC", async () => {
    const db = healthDb({ ok: true, failing: [] });
    expect(await read(await handleOpsHealth(() => db, TOKEN, ENV))).toEqual({
      status: 200,
      body: "ok",
      type: "text/plain; charset=utf-8",
      cache: "no-store",
    });
    const calls = rpcCalls(db);
    expect(calls.map((call) => call.name)).toEqual(["ops_health"]);
    const { p_now } = z.object({ p_now: z.string().datetime() }).parse(calls[0]?.args[0]);
    expect(Math.abs(Date.parse(p_now) - Date.now())).toBeLessThan(60_000);
  });

  it("answers 503 naming every failing check", async () => {
    const db = healthDb({ ok: false, failing: ["runner", "dead_jobs"] });
    const answer = await read(await handleOpsHealth(() => db, TOKEN, ENV));
    expect([answer.status, answer.body, answer.cache]).toEqual([
      503,
      "fail: runner,dead_jobs",
      "no-store",
    ]);
  });

  it("answers 404 with no RPC when the token differs", async () => {
    const db = healthDb({ ok: true, failing: [] });
    const wrong = `${TOKEN.slice(0, -1)}0`;
    const answer = await read(await handleOpsHealth(() => db, wrong, ENV));
    expect([answer.status, answer.cache]).toEqual([404, "no-store"]);
    expect(rpcCalls(db)).toEqual([]);
  });

  it("answers 404 with no RPC when the token is a prefix of the secret", async () => {
    const db = healthDb({ ok: true, failing: [] });
    const response = await handleOpsHealth(() => db, TOKEN.slice(0, -1), ENV);
    expect(response.status).toBe(404);
    expect(rpcCalls(db)).toEqual([]);
  });

  it("answers 404 with no RPC when OPS_HEALTH_TOKEN is unset, even to an empty token", async () => {
    const db = healthDb({ ok: true, failing: [] });
    const statuses = [
      (await handleOpsHealth(() => db, TOKEN, {})).status,
      (await handleOpsHealth(() => db, "", {})).status,
    ];
    expect(statuses).toEqual([404, 404]);
    expect(rpcCalls(db)).toEqual([]);
  });

  it("answers 503 fail: ops_health_rpc and logs once when the RPC fails", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const db = healthDb(new Error("connection refused"));
    const answer = await read(await handleOpsHealth(() => db, TOKEN, ENV));
    expect([answer.status, answer.body]).toEqual([503, "fail: ops_health_rpc"]);
    expect(logged.mock.calls.map(([line]) => String(line))).toEqual([
      JSON.stringify({ level: "error", event: "ops_health_failed", message: "connection refused" }),
    ]);
  });

  it("answers 503 fail: ops_health_rpc when the Worker holds no database key", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const noDb = () => {
      throw new Error("The database is not available.");
    };
    const answer = await read(await handleOpsHealth(noDb, TOKEN, ENV));
    expect([answer.status, answer.body]).toEqual([503, "fail: ops_health_rpc"]);
  });

  it("answers 503 fail: ops_health_rpc to an answer of the wrong shape", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const answer = await read(
      await handleOpsHealth(() => healthDb({ ok: "yes", failing: [] }), TOKEN, ENV),
    );
    expect([answer.status, answer.body]).toEqual([503, "fail: ops_health_rpc"]);
  });
});
