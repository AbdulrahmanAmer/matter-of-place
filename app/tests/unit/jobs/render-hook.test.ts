import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { Database, Json } from "../../../src/db";
import type { StepContext, StepDefinition } from "../../../src/server/jobs/types";
import { signBody } from "../../../src/server/lib/hmac";
import type { FakeDb } from "../../fixtures/fake-db";
import { fakeDb } from "../../fixtures/fake-db";

const registry = new Map<string, StepDefinition>();
vi.mock(import("../../../src/server/jobs/steps/index.ts"), async (importOriginal) => {
  const actual = await importOriginal();
  return { getStep: (type: string) => registry.get(type) ?? actual.getStep(type) };
});

type JobRow = Database["public"]["Tables"]["jobs"]["Row"];

const SECRET = "render-hook-test-secret";
const URL = "https://matter-of-place-dev.holy-meadow-4327.workers.dev/api/hooks/render/callback";
const REQUEST_ID = "req-render-1";
const JOB_ID = "3f2a9c1d-0000-4000-8000-000000000001";
const CLAIM = "7d1e0c52-0000-4000-8000-000000000002";
const NEWER_CLAIM = "7d1e0c52-0000-4000-8000-000000000003";
const RUN_URL = "https://github.com/AbdulrahmanAmer/matter-of-place/actions/runs/1";
const FIXTURE = "test.render_fixture";
const STORED = { spec_hash: "abc123" };

function jobRow(overrides: Partial<JobRow> = {}): JobRow {
  return {
    id: JOB_ID,
    type: FIXTURE,
    payload: { params: {}, data: {} },
    idempotency_key: "test:render-hook",
    status: "running",
    attempts: 0,
    max_attempts: 5,
    run_after: "2026-10-04T00:00:00Z",
    locked_at: "2026-10-04T00:00:00Z",
    locked_by: CLAIM,
    heavy: true,
    run_local: false,
    recipe_id: null,
    step_id: null,
    event_id: null,
    result: STORED,
    error: null,
    msg_id: 1,
    created_at: "2026-10-04T00:00:00Z",
    updated_at: "2026-10-04T00:00:00Z",
    finished_at: null,
    job_event_entity_id: null,
    ...overrides,
  };
}

/** A heavy fixture step with the given `onResult`, registered for the type of `jobRow`. */
function registerFixture(onResult: NonNullable<StepDefinition["onResult"]>): void {
  registry.set(FIXTURE, {
    type: FIXTURE,
    heavy: true,
    paramsSchema: z.unknown(),
    run: () => Promise.resolve({ status: "dispatched" }),
    onResult,
  });
}

/** The claim-fenced SQL functions over one in-memory row, and the hook's one table read (P-905). */
function setup(row: JobRow | null = jobRow()): { db: FakeDb; row: JobRow | null } {
  const holds = (jobId: string, claim: string) =>
    row !== null && row.id === jobId && row.status === "running" && row.locked_by === claim;
  const db = fakeDb({
    rpc: {
      finish_job: (args) => {
        if (row === null || !holds(args.p_job_id, args.p_claim)) return false;
        Object.assign(row, { status: "done", result: args.p_result ?? row.result });
        return true;
      },
      fail_job: (args) => {
        if (row === null || !holds(args.p_job_id, args.p_claim)) return false;
        Object.assign(row, {
          status: args.p_dead === true ? "dead" : "failed",
          error: args.p_error,
        });
        return true;
      },
      ops_health: () => ({ ok: true, failing: [] }),
    },
  });
  const from = (name: string) => {
    db.calls.push({ kind: "from", name, args: [] });
    return {
      select: () => ({
        eq: (_column: string, id: string) => ({
          maybeSingle: () =>
            Promise.resolve({ data: row?.id === id ? { ...row } : null, error: null }),
        }),
      }),
    };
  };
  return { db: Object.assign(db, { from }), row };
}

// env.ts parses `process.env` when it is first imported (G-300); an empty value counts as unset.
async function loadHook(secret: string) {
  vi.resetModules();
  vi.stubEnv("MOP_ENV", "local");
  vi.stubEnv("RATE_LIMIT_SALT", "salt");
  vi.stubEnv("RENDER_CALLBACK_SECRET", secret);
  const { handleRenderCallback } = await import("../../../src/server/hooks/render");
  vi.unstubAllEnvs();
  return handleRenderCallback;
}

interface Sent {
  body?: Record<string, unknown> | string;
  ageSeconds?: number;
  signature?: string;
}

async function callback({ body = {}, ageSeconds = 0, signature }: Sent): Promise<Request> {
  const raw =
    typeof body === "string"
      ? body
      : JSON.stringify({
          job_id: JOB_ID,
          claim: CLAIM,
          status: "done",
          result: { files: [] },
          run_url: RUN_URL,
          ...body,
        });
  const timestamp = String(Math.floor(Date.now() / 1000) - ageSeconds);
  return new Request(URL, {
    method: "POST",
    body: raw,
    headers: {
      "content-type": "application/json",
      "x-mop-timestamp": timestamp,
      "x-mop-signature": signature ?? (await signBody(SECRET, timestamp, raw)),
    },
  });
}

async function send(db: FakeDb, sent: Sent = {}, secret = SECRET) {
  const hook = await loadHook(secret);
  const response = await hook(db, await callback(sent), { MOP_ENV: "preview" }, REQUEST_ID);
  const body: unknown = await response.json();
  return { status: response.status, body };
}

const rpcArgs = (db: FakeDb, name: string) =>
  db.calls.filter((call) => call.kind === "rpc" && call.name === name).map((call) => call.args[0]);
const rpcCount = (db: FakeDb) => db.calls.filter((call) => call.kind === "rpc").length;

const errorBody = z.object({
  error: z.object({ code: z.string(), message: z.string(), requestId: z.string() }),
});

const fenced = { p_job_id: JOB_ID, p_claim: CLAIM, p_run_url: RUN_URL };

afterEach(() => {
  registry.clear();
  vi.unstubAllEnvs();
});

describe("handleRenderCallback", () => {
  it("applies a valid callback with one finish_job under its claim and run", async () => {
    const { db, row } = setup();
    expect(await send(db)).toEqual({ status: 200, body: { applied: "done" } });
    expect(rpcArgs(db, "finish_job")).toEqual([
      { ...fenced, p_result: { files: [] }, p_dispatched: false },
    ]);
    expect(row?.status).toBe("done");
  });

  it("answers a repeat with 200 and changes nothing a second time", async () => {
    const { db, row } = setup();
    await send(db);
    const after = { ...row };
    expect(await send(db)).toEqual({ status: 200, body: { ignored: "stale_claim" } });
    expect(rpcCount(db)).toBe(1);
    expect(row).toEqual(after);
  });

  it("ignores a claim from before a manual retry with no change (JOB-02)", async () => {
    const { db, row } = setup(jobRow({ locked_by: NEWER_CLAIM }));
    expect(await send(db)).toEqual({ status: 200, body: { ignored: "stale_claim" } });
    expect(rpcCount(db)).toBe(0);
    expect(row?.status).toBe("running");
  });

  it("refuses a timestamp 301 seconds old with 401 and reads nothing", async () => {
    const { db } = setup();
    const answer = await send(db, { ageSeconds: 301 });
    expect([answer.status, errorBody.parse(answer.body).error.requestId]).toEqual([
      401,
      REQUEST_ID,
    ]);
    expect(db.calls).toEqual([]);
  });

  it("accepts a timestamp 299 seconds old", async () => {
    const { db } = setup();
    expect((await send(db, { ageSeconds: 299 })).status).toBe(200);
  });

  it("refuses a bad signature with 401 and reads nothing", async () => {
    const { db } = setup();
    const answer = await send(db, { signature: `sha256=${"0".repeat(64)}` });
    expect([answer.status, errorBody.parse(answer.body).error.code]).toEqual([401, "forbidden"]);
    expect(db.calls).toEqual([]);
  });

  it("answers 404 for an unknown job_id with no RPC", async () => {
    const { db } = setup(null);
    const answer = await send(db);
    expect([answer.status, errorBody.parse(answer.body).error.code]).toEqual([404, "not_found"]);
    expect(rpcCount(db)).toBe(0);
  });

  it.each([
    ["text that is not JSON", "not json"],
    ["an unknown status", { status: "maybe" }],
    ["a job_id that is not a uuid", { job_id: "job-1" }],
  ])("answers 400 to %s", async (_name, body) => {
    const { db } = setup();
    const answer = await send(db, { body });
    expect([answer.status, errorBody.parse(answer.body).error.code]).toEqual([400, "bad_request"]);
    expect(db.calls).toEqual([]);
  });

  it("calls fail_job on status failed, retryable by default", async () => {
    const { db, row } = setup();
    const answer = await send(db, { body: { status: "failed", error: "storage_unavailable" } });
    expect(answer).toEqual({ status: 200, body: { applied: "failed" } });
    expect(rpcArgs(db, "fail_job")).toEqual([
      { ...fenced, p_error: "storage_unavailable", p_dead: false },
    ]);
    expect(row?.status).toBe("failed");
  });

  it("sends retryable false to fail_job as p_dead", async () => {
    const { db, row } = setup();
    await send(db, { body: { status: "failed", error: "not_implemented", retryable: false } });
    expect(rpcArgs(db, "fail_job")).toEqual([
      { ...fenced, p_error: "not_implemented", p_dead: true },
    ]);
    expect(row?.status).toBe("dead");
  });

  it("calls fail_job when onResult throws, and never finish_job", async () => {
    registerFixture(() => Promise.reject(new Error("assets_write_failed")));
    const { db, row } = setup();
    expect((await send(db)).status).toBe(200);
    expect(rpcArgs(db, "finish_job")).toEqual([]);
    expect(rpcArgs(db, "fail_job")).toEqual([
      { ...fenced, p_error: "on_result: assets_write_failed", p_dead: false },
    ]);
    expect(row?.status).toBe("failed");
  });

  it("gives onResult a Date now, the stored jobs.result and the callback result", async () => {
    const seen: { now: unknown; stored: unknown; result: Json | undefined }[] = [];
    registerFixture((ctx: StepContext, job, result) => {
      seen.push({ now: ctx.now, stored: job.result, result });
      return Promise.resolve();
    });
    const { db } = setup();
    await send(db);
    expect(seen.map(({ now, stored, result }) => [now instanceof Date, stored, result])).toEqual([
      [true, STORED, { files: [] }],
    ]);
  });

  it("answers 503 unavailable and calls nothing when the secret is unset", async () => {
    const { db } = setup();
    const answer = await send(db, {}, "");
    expect([answer.status, errorBody.parse(answer.body).error.code]).toEqual([503, "unavailable"]);
    expect(db.calls).toEqual([]);
  });

  it("keeps a 40-item callback to 5 calls when onResult makes 3 (JOB-03)", async () => {
    registerFixture(async (ctx, _job, result) => {
      const items = Array.isArray(result) ? result : [];
      await Promise.all(
        [items, items, items].map(() => ctx.db.rpc("ops_health", { p_now: ctx.now.toISOString() })),
      );
    });
    const { db } = setup();
    const items = Array.from({ length: 40 }, (_, index) => ({ media_id: `m${String(index)}` }));
    expect((await send(db, { body: { result: items } })).status).toBe(200);
    expect(db.calls.length).toBeLessThanOrEqual(5);
  });
});
