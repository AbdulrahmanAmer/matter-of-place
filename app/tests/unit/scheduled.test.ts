import "../fixtures/worker-env";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Json } from "../../src/db";
import { fakeDb, type FakeDb } from "../fixtures/fake-db";
import { stateJson } from "../fixtures/snapshot";

// The keep-warm tick (B8b invariant 15 c) against B3's fakeDb, whose `calls` count every RPC and query, a stub for
// Nitro's in-process fetch and a spy `report`. A fresh module per case, so the state memo of one tick never serves the next.

const NOW = new Date("2026-10-05T10:10:00.000Z");
const CRON = "*/10 * * * *";

interface Rpcs {
  claim?: boolean | Error;
  state?: Error;
  beat?: Error;
  liveness?: Json | Error;
}

const fresh = (): Json => ({
  runner_beat_at: "2026-10-05T10:09:00.000Z",
  oldest_due_age_s: null,
});

function setup({ claim = true, state, beat, liveness = fresh() }: Rpcs = {}): FakeDb {
  return fakeDb({
    rpc: {
      claim_schedule: () => claim,
      public_state: () => state ?? stateJson(),
      beat: () => beat ?? undefined,
      jobs_liveness: () => liveness,
    },
  });
}

const pages: Request[] = [];
const reports: { error: Error; fingerprint: string[] }[] = [];
let lines: string[] = [];

async function tick(db: FakeDb, mopEnv: string | undefined = "production"): Promise<void> {
  vi.resetModules();
  const { runKeepWarm } = await import("../../src/server/scheduled");
  await runKeepWarm({
    db,
    fetch: (request) => {
      pages.push(request);
      return Promise.resolve(new Response("page", { headers: { "x-mop-cache": "hit" } }));
    },
    cron: CRON,
    origin: "https://example.test",
    now: NOW,
    mopEnv,
    report: (error, options) => {
      reports.push({ error, fingerprint: options.fingerprint });
      return Promise.resolve();
    },
  });
}

beforeEach(() => {
  pages.length = 0;
  reports.length = 0;
  lines = [];
  const capture = (line: string) => {
    lines.push(line);
  };
  vi.spyOn(console, "log").mockImplementation(capture);
  vi.spyOn(console, "warn").mockImplementation(capture);
  vi.spyOn(console, "error").mockImplementation(capture);
  // No outside call: a tick that reached the network would fail here.
  vi.stubGlobal("fetch", () => Promise.reject(new Error("outside call")));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const events = (): unknown[] =>
  lines.map((line) => {
    const parsed: unknown = JSON.parse(line);
    const event: unknown =
      typeof parsed === "object" && parsed !== null ? Reflect.get(parsed, "event") : undefined;
    return event;
  });

const rpcNames = (db: FakeDb) => db.calls.map((call) => `${call.kind}:${call.name}`);

describe("runKeepWarm", () => {
  it("in production makes one clock claim, one state RPC, one beat, one liveness RPC and one page request", async () => {
    const db = setup();
    await tick(db);
    expect(rpcNames(db)).toEqual([
      "rpc:claim_schedule",
      "rpc:public_state",
      "rpc:beat",
      "rpc:jobs_liveness",
    ]);
    expect(pages.map((page) => [page.method, page.url])).toEqual([
      ["GET", "https://example.test/"],
    ]);
    expect(db.calls[0]?.args).toEqual([
      {
        p_key: "keepwarm",
        p_guard: false,
        p_last_run_at: NOW.toISOString(),
        p_next_run_at: "2026-10-05T10:20:00.000Z",
      },
    ]);
    expect(db.calls[2]?.args).toEqual([{ p_name: "keepwarm", p_detail: { cron: CRON } }]);
    expect(lines.map((line) => JSON.parse(line) as unknown)).toEqual([
      { level: "info", event: "keepwarm_tick", status: 200, cache: "hit", stateRpc: 1 },
    ]);
    expect(reports).toEqual([]);
  });

  it("outside production makes the same calls without jobs_liveness", async () => {
    const db = setup();
    await tick(db, "preview");
    expect(rpcNames(db)).toEqual(["rpc:claim_schedule", "rpc:public_state", "rpc:beat"]);
    expect(pages).toHaveLength(1);
  });

  it("a disabled row ends the tick after the one claim, with no page request", async () => {
    const db = setup({ claim: false });
    await tick(db);
    expect(rpcNames(db)).toEqual(["rpc:claim_schedule"]);
    expect(pages).toEqual([]);
    expect(events()).toEqual(["keepwarm_disabled"]);
  });

  it.each([
    [
      "a beat 6 minutes old",
      { runner_beat_at: "2026-10-05T10:04:00.000Z", oldest_due_age_s: null },
      1,
    ],
    ["no beat at all", { runner_beat_at: null, oldest_due_age_s: null }, 1],
    [
      "a beat 2 minutes old and a job due 60 s",
      { runner_beat_at: "2026-10-05T10:08:00.000Z", oldest_due_age_s: 60 },
      0,
    ],
    [
      "a beat 2 minutes old and a job due 901 s",
      { runner_beat_at: "2026-10-05T10:08:00.000Z", oldest_due_age_s: 901 },
      1,
    ],
  ])(
    "reports the stalled runner for %s the expected number of times",
    async (_name, answer, count) => {
      await tick(setup({ liveness: answer }));
      expect(reports.map((report) => [report.error.message, report.fingerprint])).toEqual(
        Array.from({ length: count }, () => ["job_runner_stalled", ["job_runner_stalled"]]),
      );
    },
  );

  it.each([
    ["the claim", { claim: new Error("down") }, "keepwarm_last_run_update_failed"],
    ["the state RPC", { state: new Error("down") }, "keepwarm_state_rpc_failed"],
    ["the beat", { beat: new Error("down") }, "keepwarm_beat_failed"],
    ["the liveness RPC", { liveness: new Error("down") }, "keepwarm_liveness_rpc_failed"],
  ])("a failing %s is logged once and the tick still finishes", async (_name, failure, event) => {
    await tick(setup(failure));
    expect(events().filter((name) => name === event)).toEqual([event]);
    expect(events()).toContain("keepwarm_tick");
    expect(pages).toHaveLength(1);
  });
});
