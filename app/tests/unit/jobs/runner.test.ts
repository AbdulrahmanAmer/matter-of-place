import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { Database } from "../../../src/db";
import { fanoutPendingEvents } from "../../../src/server/automation/fanout";
import { runOnce } from "../../../src/server/jobs/runner";
import { runDueSchedules } from "../../../src/server/jobs/scheduler";
import { dispatchHeavy } from "../../../src/server/jobs/steps/heavy";
import { getStep } from "../../../src/server/jobs/steps/index";
import type {
  JsonObject,
  Reporter,
  RunnerEnv,
  StepContext,
  StepDefinition,
  StepResult,
} from "../../../src/server/jobs/types";
import { NonRetryableError } from "../../../src/server/jobs/types";
import { storageUnavailable } from "../../../src/server/lib/media-store";
import type { FakeDb } from "../../fixtures/fake-db";
import { fakeDb } from "../../fixtures/fake-db";

// Steps a case registers by type; any other type falls through to the real catalog.
const registry = vi.hoisted(() => new Map<string, StepDefinition>());

vi.mock(import("../../../src/server/jobs/steps/index.ts"), async (importOriginal) => {
  const actual = await importOriginal();
  return { getStep: (type: string) => registry.get(type) ?? actual.getStep(type) };
});
vi.mock(import("../../../src/server/automation/fanout.ts"), { spy: true });
vi.mock(import("../../../src/server/jobs/scheduler.ts"), { spy: true });

type JobRow = Database["public"]["Functions"]["claim_job"]["Returns"][number];

const NOW = new Date("2026-10-04T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;
const CALLBACK =
  "https://matter-of-place-dev.holy-meadow-4327.workers.dev/api/hooks/render/callback";
const ENV: RunnerEnv = {
  MOP_ENV: "preview",
  GITHUB_DISPATCH_TOKEN: "test-dispatch-token",
  GITHUB_REPO: "AbdulrahmanAmer/matter-of-place",
  RENDER_CALLBACK_URL: CALLBACK,
};

const report = vi.fn<Reporter>(() => Promise.resolve());
const fetchSpy = vi.fn<(input: string, init: RequestInit) => Promise<Response>>();

let seq = 0;
function job(type: string, overrides: Partial<JobRow> = {}): JobRow {
  seq += 1;
  const id = `3f2a9c1d-0000-4000-8000-${String(seq).padStart(12, "0")}`;
  return {
    id,
    type,
    attempts: 0,
    max_attempts: 5,
    status: "queued",
    created_at: NOW.toISOString(),
    error: null,
    event_id: null,
    finished_at: null,
    heavy: false,
    idempotency_key: `test:${id}`,
    locked_at: null,
    locked_by: null,
    msg_id: seq,
    payload: { params: {}, data: {} },
    recipe_id: null,
    result: null,
    run_after: NOW.toISOString(),
    run_local: false,
    step_id: null,
    updated_at: NOW.toISOString(),
    ...overrides,
  };
}

function step(
  type: string,
  run: (ctx: StepContext, params: unknown, data: JsonObject) => Promise<StepResult>,
  extra: Partial<StepDefinition> = {},
): StepDefinition {
  const definition: StepDefinition = {
    type,
    heavy: false,
    paramsSchema: z.unknown(),
    run,
    ...extra,
  };
  registry.set(type, definition);
  return definition;
}

const claimOf = (row: JobRow): string => `claim-${row.id}`;

interface Setup {
  jobs: JobRow[];
  light?: JobRow[];
  heavy?: JobRow[];
  readLight?: (qty: number) => { job_id: string; msg_id: number; read_ct: number }[];
}

// The queues hold one message per listed job; claim_job claims a queued or failed row once.
function setup({ jobs, light = [], heavy = [], readLight }: Setup): FakeDb {
  const find = (id: string) => jobs.find((row) => row.id === id);
  const claimed = new Set<string>();
  const message = (row: JobRow) => ({ job_id: row.id, msg_id: row.msg_id ?? 0, read_ct: 1 });
  const queues = { light: light.map(message), heavy: heavy.map(message) };
  const db = fakeDb({
    rpc: {
      job_queue_read: ({ p_heavy, p_qty }) =>
        p_heavy
          ? queues.heavy.splice(0, p_qty)
          : (readLight?.(p_qty) ?? queues.light.splice(0, p_qty)),
      job_queue_delete: () => true,
      claim_job: ({ p_job_id }) => {
        const row = find(p_job_id);
        if (row === undefined || claimed.has(row.id)) return [];
        if (row.status !== "queued" && row.status !== "failed") return [];
        claimed.add(row.id);
        return [{ ...row, status: "running", locked_by: claimOf(row) }];
      },
      finish_job: () => true,
      fail_job: () => true,
      requeue_job: () => true,
      reap_stale_jobs: () => ({ lease_expired: 0, callback_timeout: 0, resent: 0 }),
    },
  });
  // B3's fakeDb answers `from(...).select()` with no filter; the runner reads `run_local` with `.in("id", ids)`.
  return Object.assign(db, {
    from: (name: string) => {
      db.calls.push({ kind: "from", name, args: [] });
      return {
        select: () => ({
          in: (_column: string, ids: string[]) =>
            Promise.resolve({
              data: ids.map((id) => ({ id, run_local: find(id)?.run_local ?? false })),
              error: null,
            }),
        }),
      };
    },
  });
}

const rpcArgs = (db: FakeDb, name: string): unknown[] =>
  db.calls.filter((call) => call.kind === "rpc" && call.name === name).map((call) => call.args[0]);

const rpcNames = (db: FakeDb): string[] =>
  db.calls.filter((call) => call.kind === "rpc").map((call) => call.name);

const tick = (db: FakeDb, env: RunnerEnv = ENV) => runOnce(db, { env, report, now: NOW });

function sentPayload(): unknown {
  const raw = fetchSpy.mock.calls[0]?.[1].body;
  const body = z
    .object({ inputs: z.object({ job: z.string() }) })
    .parse(JSON.parse(typeof raw === "string" ? raw : "null"));
  return JSON.parse(body.inputs.job);
}

beforeEach(() => {
  vi.stubEnv("MOP_ENV", "preview");
  fetchSpy.mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  registry.clear();
  report.mockClear();
  fetchSpy.mockReset();
  vi.mocked(fanoutPendingEvents).mockClear();
  vi.mocked(runDueSchedules).mockClear();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("runOnce outcomes", () => {
  it("finishes a job whose step is done, with its result", async () => {
    step("t.done", () => Promise.resolve({ status: "done", result: { n: 1 } }));
    const row = job("t.done");
    const db = setup({ jobs: [row], light: [row] });
    const summary = await tick(db);
    expect(summary).toEqual({ claimed: 1, jobs: [{ id: row.id, outcome: "done" }] });
    expect(rpcArgs(db, "finish_job")).toEqual([
      { p_job_id: row.id, p_claim: claimOf(row), p_result: { n: 1 }, p_dispatched: false },
    ]);
  });

  it("fails a job whose step throws, using one attempt", async () => {
    step("t.throw", () => Promise.reject(new Error("provider_down")));
    const row = job("t.throw");
    const db = setup({ jobs: [row], light: [row] });
    expect((await tick(db)).jobs).toEqual([
      { id: row.id, outcome: "failed", reason: "provider_down" },
    ]);
    expect(rpcArgs(db, "fail_job")).toEqual([
      { p_job_id: row.id, p_claim: claimOf(row), p_error: "provider_down", p_dead: false },
    ]);
    expect(report).not.toHaveBeenCalled();
  });

  it("sends a throw at the last attempt to dead and reports it once", async () => {
    step("t.throw", () => Promise.reject(new Error("provider_down")));
    const row = job("t.throw", { attempts: 4, max_attempts: 5 });
    const db = setup({ jobs: [row], light: [row] });
    expect((await tick(db)).jobs).toEqual([
      { id: row.id, outcome: "dead", reason: "provider_down" },
    ]);
    expect(report).toHaveBeenCalledTimes(1);
    expect(report.mock.calls[0]?.[1]).toEqual({ fingerprint: ["job_dead", "t.throw"] });
  });

  it("sends NonRetryableError to dead after one attempt", async () => {
    step("t.refuse", () => Promise.reject(new NonRetryableError("bad_input")));
    const row = job("t.refuse");
    const db = setup({ jobs: [row], light: [row] });
    expect((await tick(db)).jobs).toEqual([{ id: row.id, outcome: "dead", reason: "bad_input" }]);
    expect(rpcArgs(db, "fail_job")).toEqual([
      { p_job_id: row.id, p_claim: claimOf(row), p_error: "bad_input", p_dead: true },
    ]);
    expect(report).toHaveBeenCalledTimes(1);
  });

  it("requeues an unknown type 23 hours old 15 minutes ahead with no attempt used", async () => {
    const row = job("t.not_yet_built", {
      created_at: new Date(NOW.getTime() - 23 * HOUR).toISOString(),
    });
    const db = setup({ jobs: [row], light: [row] });
    expect((await tick(db)).jobs).toEqual([
      { id: row.id, outcome: "requeued", reason: "unknown_step" },
    ]);
    expect(rpcArgs(db, "requeue_job")).toEqual([
      {
        p_job_id: row.id,
        p_claim: claimOf(row),
        p_run_after: "2026-10-04T12:15:00.000Z",
        p_kind: "requeued",
        p_result: null,
      },
    ]);
    expect(rpcNames(db)).not.toContain("fail_job");
  });

  it("sends an unknown type 25 hours old to dead with unknown_step", async () => {
    const row = job("t.not_yet_built", {
      created_at: new Date(NOW.getTime() - 25 * HOUR).toISOString(),
    });
    const db = setup({ jobs: [row], light: [row] });
    expect((await tick(db)).jobs).toEqual([
      { id: row.id, outcome: "dead", reason: "unknown_step" },
    ]);
    expect(rpcArgs(db, "fail_job")).toEqual([
      { p_job_id: row.id, p_claim: claimOf(row), p_error: "unknown_step", p_dead: true },
    ]);
  });

  it("retry_at keeps attempts: the job is requeued and never failed", async () => {
    const at = new Date("2026-10-04T18:00:00.000Z");
    step("t.later", () => Promise.resolve({ status: "retry_at", at, reason: "quota" }));
    const row = job("t.later", { attempts: 2 });
    const db = setup({ jobs: [row], light: [row] });
    expect((await tick(db)).jobs).toEqual([{ id: row.id, outcome: "requeued", reason: "quota" }]);
    expect(rpcArgs(db, "requeue_job")).toEqual([
      {
        p_job_id: row.id,
        p_claim: claimOf(row),
        p_run_after: at.toISOString(),
        p_kind: "requeued",
        p_result: null,
      },
    ]);
    expect(rpcNames(db)).not.toContain("fail_job");
  });

  it("retry_at with a result persists it in jobs.result", async () => {
    const at = new Date("2026-10-04T18:00:00.000Z");
    step("t.later", () =>
      Promise.resolve({ status: "retry_at", at, reason: "next_batch", result: { sent: 40 } }),
    );
    const row = job("t.later");
    const db = setup({ jobs: [row], light: [row] });
    await tick(db);
    expect(rpcArgs(db, "requeue_job")).toEqual([
      {
        p_job_id: row.id,
        p_claim: claimOf(row),
        p_run_after: at.toISOString(),
        p_kind: "requeued",
        p_result: { sent: 40 },
      },
    ]);
  });

  it("gives the step what the last attempt stored as ctx.job.result", async () => {
    step("t.resume", (ctx) => Promise.resolve({ status: "done", result: ctx.job.result }));
    const row = job("t.resume", { result: { sent: 40 } });
    const db = setup({ jobs: [row], light: [row] });
    await tick(db);
    expect(rpcArgs(db, "finish_job")).toEqual([
      { p_job_id: row.id, p_claim: claimOf(row), p_result: { sent: 40 }, p_dispatched: false },
    ]);
  });

  it("passes opts.now to the step as the Date ctx.now, with params and data from the envelope", async () => {
    const seen: unknown[] = [];
    step("t.clock", (ctx, params, data) => {
      seen.push(ctx.now instanceof Date, ctx.now.toISOString(), params, data);
      return Promise.resolve({ status: "done" });
    });
    const row = job("t.clock", { payload: { params: { size: 2 }, data: { property_id: "p1" } } });
    await tick(setup({ jobs: [row], light: [row] }));
    expect(seen).toEqual([true, NOW.toISOString(), { size: 2 }, { property_id: "p1" }]);
  });

  it("sends a job whose params fail the step's schema to dead with invalid_params", async () => {
    step("t.strict", () => Promise.resolve({ status: "done" }), {
      paramsSchema: z.object({ size: z.number() }),
    });
    const row = job("t.strict", { payload: { params: { size: "big" }, data: {} } });
    const db = setup({ jobs: [row], light: [row] });
    expect((await tick(db)).jobs).toEqual([
      { id: row.id, outcome: "dead", reason: "invalid_params" },
    ]);
  });

  it("requeues a step that throws storage_unavailable an hour ahead with no attempt used", async () => {
    step("t.storage", () => Promise.reject(storageUnavailable()));
    const row = job("t.storage", { attempts: 1 });
    const db = setup({ jobs: [row], light: [row] });
    expect((await tick(db)).jobs).toEqual([
      { id: row.id, outcome: "requeued", reason: "storage_unavailable" },
    ]);
    expect(rpcArgs(db, "requeue_job")).toEqual([
      {
        p_job_id: row.id,
        p_claim: claimOf(row),
        p_run_after: "2026-10-04T13:00:00.000Z",
        p_kind: "requeued",
        p_result: null,
      },
    ]);
    expect(rpcNames(db)).not.toContain("fail_job");
  });
});

describe("runOnce heavy dispatch", () => {
  it("marks the job running and sends claim, env and callback_url; a 204 keeps it running", async () => {
    const row = job("test.selftest_heavy", {
      heavy: true,
      payload: { params: {}, data: { n: 1 } },
    });
    const db = setup({ jobs: [row], heavy: [row] });
    expect((await tick(db)).jobs).toEqual([{ id: row.id, outcome: "dispatched" }]);
    expect(rpcArgs(db, "claim_job")).toEqual([{ p_job_id: row.id }]);
    expect(sentPayload()).toEqual({
      job_id: row.id,
      claim: claimOf(row),
      type: "test.selftest_heavy",
      payload: { params: {}, data: { n: 1 } },
      env: "preview",
      callback_url: CALLBACK,
    });
    expect(rpcArgs(db, "finish_job")).toEqual([
      { p_job_id: row.id, p_claim: claimOf(row), p_result: null, p_dispatched: true },
    ]);
  });

  it("sends payload.data merged with extra and stores extra in jobs.result", async () => {
    step(
      "t.render",
      (ctx, _params, data) =>
        dispatchHeavy(ctx, { params: {}, data }, { spec_hash: "h1", revision: 3 }),
      { heavy: true },
    );
    const row = job("t.render", { heavy: true, payload: { params: {}, data: { asset_id: "a1" } } });
    const db = setup({ jobs: [row], heavy: [row] });
    await tick(db);
    expect(sentPayload()).toMatchObject({
      payload: { params: {}, data: { asset_id: "a1", spec_hash: "h1", revision: 3 } },
    });
    expect(rpcArgs(db, "finish_job")).toEqual([
      {
        p_job_id: row.id,
        p_claim: claimOf(row),
        p_result: { spec_hash: "h1", revision: 3 },
        p_dispatched: true,
      },
    ]);
  });

  it("sends a client_payload over 65,535 characters to dead with payload_too_large and no call", async () => {
    const row = job("test.selftest_heavy", {
      heavy: true,
      payload: { params: {}, data: { blob: "x".repeat(65_535) } },
    });
    const db = setup({ jobs: [row], heavy: [row] });
    expect((await tick(db)).jobs).toEqual([
      { id: row.id, outcome: "dead", reason: "payload_too_large" },
    ]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("requeues an hour ahead with no attempt and no call when GITHUB_DISPATCH_TOKEN is unset", async () => {
    const row = job("test.selftest_heavy", { heavy: true });
    const db = setup({ jobs: [row], heavy: [row] });
    const summary = await tick(db, { ...ENV, GITHUB_DISPATCH_TOKEN: undefined });
    expect(summary.jobs).toEqual([
      { id: row.id, outcome: "requeued", reason: "dispatch_not_configured" },
    ]);
    expect(rpcArgs(db, "requeue_job")).toEqual([
      {
        p_job_id: row.id,
        p_claim: claimOf(row),
        p_run_after: "2026-10-04T13:00:00.000Z",
        p_kind: "requeued",
        p_result: null,
      },
    ]);
    expect(rpcNames(db)).not.toContain("fail_job");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("uses one attempt on a 502 (backoff)", async () => {
    fetchSpy.mockResolvedValue(new Response("bad gateway", { status: 502 }));
    const row = job("test.selftest_heavy", { heavy: true });
    const db = setup({ jobs: [row], heavy: [row] });
    expect((await tick(db)).jobs).toEqual([
      { id: row.id, outcome: "failed", reason: "dispatch_502" },
    ]);
  });

  it.each([401, 403, 404, 422])(
    "sends a %i answer to dead with dispatch_<status>",
    async (status) => {
      fetchSpy.mockResolvedValue(new Response("{}", { status }));
      const row = job("test.selftest_heavy", { heavy: true });
      const db = setup({ jobs: [row], heavy: [row] });
      expect((await tick(db)).jobs).toEqual([
        { id: row.id, outcome: "dead", reason: `dispatch_${String(status)}` },
      ]);
    },
  );

  it("starts at most HEAVY_PER_TICK (3) heavy jobs per tick", async () => {
    const rows = Array.from({ length: 5 }, () => job("test.selftest_heavy", { heavy: true }));
    const db = setup({ jobs: rows, heavy: rows });
    expect((await tick(db)).claimed).toBe(3);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });
});

describe("runOnce messages", () => {
  it("deletes the message of a run_local job and neither claims nor changes the job", async () => {
    const row = job("write_captions", { run_local: true });
    const db = setup({ jobs: [row], light: [row] });
    expect(await tick(db)).toEqual({ claimed: 0, jobs: [] });
    expect(rpcNames(db)).not.toContain("claim_job");
    expect(rpcArgs(db, "job_queue_delete")).toEqual([{ p_heavy: false, p_msg_id: row.msg_id }]);
  });

  it("deletes a duplicate message of a done job and archives nothing", async () => {
    const row = job("t.done", { status: "done" });
    const db = setup({ jobs: [row], light: [row] });
    expect(await tick(db)).toEqual({ claimed: 0, jobs: [] });
    expect(rpcArgs(db, "job_queue_delete")).toEqual([{ p_heavy: false, p_msg_id: row.msg_id }]);
    expect(rpcNames(db).filter((name) => name.includes("archive"))).toEqual([]);
  });

  it("calls the two stubs once per tick, fanoutPendingEvents with 50, and the reaper once", async () => {
    const db = setup({ jobs: [] });
    await tick(db);
    expect(vi.mocked(fanoutPendingEvents).mock.calls).toEqual([[db, 50]]);
    expect(vi.mocked(runDueSchedules).mock.calls).toEqual([[db, NOW]]);
    expect(rpcNames(db).filter((name) => name === "reap_stale_jobs")).toHaveLength(1);
  });
});

describe("runOnce time limits", () => {
  it("aborts a step that never resolves at its timeoutMs with one attempt and step_timeout", async () => {
    step("t.hang", () => new Promise<StepResult>(() => undefined), { timeoutMs: 30 });
    const row = job("t.hang");
    const db = setup({ jobs: [row], light: [row] });
    expect((await tick(db)).jobs).toEqual([
      { id: row.id, outcome: "failed", reason: "step_timeout" },
    ]);
    expect(rpcArgs(db, "fail_job")).toEqual([
      { p_job_id: row.id, p_claim: claimOf(row), p_error: "step_timeout", p_dead: false },
    ]);
  });

  it("runs a light step under 20 s by default and never more than 40 s", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    step("t.default", () => Promise.resolve({ status: "done" }));
    step("t.long", () => Promise.resolve({ status: "done" }), { timeoutMs: 60_000 });
    const rows = [job("t.default"), job("t.long")];
    await tick(setup({ jobs: rows, light: rows }));
    expect(timeout.mock.calls).toEqual([[20_000], [40_000]]);
  });

  it("starts no new job after 40 seconds of the budget", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    step("t.slow", () => {
      vi.setSystemTime(new Date(Date.now() + 41_000));
      return Promise.resolve({ status: "done" });
    });
    const rows = [job("t.slow"), job("t.slow"), job("t.slow")];
    const db = setup({ jobs: rows, light: rows });
    expect((await tick(db)).claimed).toBe(1);
    expect(rpcArgs(db, "job_queue_delete")).toHaveLength(1);
  });

  it("time budget stops the loop over a queue that never empties", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    step("t.five", () => {
      vi.setSystemTime(new Date(Date.now() + 5_000));
      return Promise.resolve({ status: "done" });
    });
    const rows: JobRow[] = [];
    const db = setup({
      jobs: rows,
      readLight: (qty) =>
        Array.from({ length: qty }, () => {
          const row = job("t.five");
          rows.push(row);
          return { job_id: row.id, msg_id: row.msg_id ?? 0, read_ct: 1 };
        }),
    });
    expect((await tick(db)).claimed).toBe(8);
  });
});

describe("self-test steps", () => {
  it.each([undefined, "production", "staging"])(
    "are not registered when MOP_ENV is %s",
    (value) => {
      vi.stubEnv("MOP_ENV", value);
      expect(getStep("test.selftest_light")).toBeUndefined();
      expect(getStep("test.selftest_heavy")).toBeUndefined();
    },
  );

  it.each(["development", "preview"])("are registered when MOP_ENV is %s", (value) => {
    vi.stubEnv("MOP_ENV", value);
    expect(getStep("test.selftest_light")?.heavy).toBe(false);
    expect(getStep("test.selftest_heavy")?.heavy).toBe(true);
  });

  it("leave a self-test job waiting as unknown_step when MOP_ENV is unset", async () => {
    vi.stubEnv("MOP_ENV", undefined);
    const row = job("test.selftest_light");
    const db = setup({ jobs: [row], light: [row] });
    expect((await tick(db)).jobs).toEqual([
      { id: row.id, outcome: "requeued", reason: "unknown_step" },
    ]);
  });

  it("runs test.selftest_light to done, and its fail params to failed and dead", async () => {
    const ok = job("test.selftest_light");
    const thrown = job("test.selftest_light", { payload: { params: { fail: "throw" }, data: {} } });
    const refused = job("test.selftest_light", {
      payload: { params: { fail: "nonretryable" }, data: {} },
    });
    const all = [ok, thrown, refused];
    expect((await tick(setup({ jobs: all, light: all }))).jobs).toEqual([
      { id: ok.id, outcome: "done" },
      { id: thrown.id, outcome: "failed", reason: "selftest_throw" },
      { id: refused.id, outcome: "dead", reason: "selftest_nonretryable" },
    ]);
  });
});
