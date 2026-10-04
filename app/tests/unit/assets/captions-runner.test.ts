// B9 step 9, ASSUMED H34 (3) and (7): the caption runner against the stub CLI of tests/fixtures/claude-stub.ts and a
// fake database. No call reaches the network and the real CLI never runs.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { Database, Tables } from "../../../src/db";
import { runCaptionJobs, runClaudeCli } from "../../../scripts/captions-runner";
import {
  JOB_ID,
  MEDIA_BASE,
  PROPERTY_ID,
  assetRow,
  mediaRow,
  propertyRow,
  stagedRow,
} from "../../fixtures/asset-rows";
import { fakeDb, type FakeDb } from "../../fixtures/fake-db";

type ClaimRow = Database["public"]["Functions"]["claim_job"]["Returns"][number];

const MODEL = "claude-haiku-4-5-20251001";
const CLAIM = "7d1e0c52-0000-4000-8000-000000000002";
const STAMP = "2026-10-04T09:00:00.000Z";
const SLUG = "oak-hill-residence";
const PROMPT = "PROMPT-TEXT-THAT-MUST-NOT-BE-AN-ARGUMENT";

let dir = "";
let log = "";
let network: ReturnType<typeof vi.fn<typeof fetch>>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "captions-"));
  log = join(dir, "stub.log");
  vi.stubEnv("CAPTIONS_CLI", "bun tests/fixtures/claude-stub.ts");
  vi.stubEnv("CAPTIONS_STUB_LOG", log);
  vi.stubEnv("MEDIA_PUBLIC_BASE", MEDIA_BASE);
  network = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", network);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  rmSync(dir, { recursive: true, force: true });
});

const logged = z.object({ args: z.array(z.string()), stdin_length: z.number() });
const stubCalls = () =>
  readFileSync(log, "utf8")
    .trim()
    .split("\n")
    .map((line) => logged.parse(JSON.parse(line)));

function claimRow(id: string, payload: ClaimRow["payload"], attempts = 0): ClaimRow {
  return {
    attempts,
    created_at: STAMP,
    error: null,
    event_id: null,
    finished_at: null,
    heavy: false,
    id,
    idempotency_key: `write_captions:${id}`,
    locked_at: STAMP,
    locked_by: CLAIM,
    max_attempts: 12,
    msg_id: null,
    payload,
    recipe_id: null,
    result: null,
    run_after: STAMP,
    run_local: true,
    status: "running",
    step_id: null,
    type: "write_captions",
    updated_at: STAMP,
  };
}

const DATA = { params: {}, data: { property_id: PROPERTY_ID } };
const queued = (ids: string[]): Tables<"jobs">[] =>
  ids.map((id) => ({ ...claimRow(id, DATA), job_event_entity_id: null, status: "queued" }));

interface Rows {
  jobs?: string[];
  media?: Tables<"property_media">[];
  claim?: (id: string) => ClaimRow[];
  payload?: ClaimRow["payload"];
}

function runnerDb(rows: Rows = {}): FakeDb {
  const payload = rows.payload ?? DATA;
  return fakeDb({
    rpc: {
      claim_job: ({ p_job_id }) => rows.claim?.(p_job_id) ?? [claimRow(p_job_id, payload)],
      finish_job: () => true,
      fail_job: () => true,
      requeue_job: () => true,
      upsert_asset_stub: ({ p_kind }) =>
        assetRow({ kind: p_kind, id: `asset-${p_kind}`, created_at: new Date().toISOString() }),
      set_asset_text: () => undefined,
    },
    tables: {
      jobs: queued(rows.jobs ?? [JOB_ID]),
      properties: [propertyRow({ slug: SLUG })],
      property_media: rows.media ?? [mediaRow(0), mediaRow(1), mediaRow(2)],
      assets: [assetRow({ kind: "carousel" })],
      settings: [{ key: "caption_model", value: MODEL, updated_at: STAMP, updated_by: null }],
    },
  });
}

const rpcCalls = (db: FakeDb, name: string) =>
  db.calls.filter((call) => call.kind === "rpc" && call.name === name);

describe("runClaudeCli", () => {
  it("passes the model and the output format as arguments and the prompt on stdin", async () => {
    const answer = await runClaudeCli(PROMPT, MODEL, new AbortController().signal);
    const [call] = stubCalls();
    expect(call?.args).toEqual(["-p", "--model", MODEL, "--output-format", "json"]);
    expect(call?.args.join(" ")).not.toContain(PROMPT);
    expect(call?.stdin_length).toBe(PROMPT.length);
    expect(answer.usage).toEqual({ input_tokens: 900, output_tokens: 300 });
    expect(JSON.parse(answer.text)).toMatchObject({ alt_text: expect.any(String) as unknown });
  }, 30_000);

  it("an error answer throws", async () => {
    vi.stubEnv("CAPTIONS_STUB_MODE", "error");
    await expect(runClaudeCli(PROMPT, MODEL, new AbortController().signal)).rejects.toThrow(
      "caption CLI exited with code 1",
    );
  }, 30_000);

  it("an answer that reports is_error and exits 0 throws", async () => {
    vi.stubEnv("CAPTIONS_STUB_MODE", "error_answer");
    await expect(runClaudeCli(PROMPT, MODEL, new AbortController().signal)).rejects.toThrow(
      "caption CLI answered an error",
    );
  }, 30_000);
});

describe("runCaptionJobs", () => {
  it("claims a queued job, writes the captions and finishes it once with the usage", async () => {
    const db = runnerDb();
    const lines: string[] = [];
    expect(await runCaptionJobs(db, (line) => lines.push(line))).toBe(0);
    expect(lines).toEqual([`write_captions ${JOB_ID} done`]);
    expect(rpcCalls(db, "claim_job")).toHaveLength(1);
    const finished = rpcCalls(db, "finish_job");
    expect(finished).toHaveLength(1);
    expect(finished[0]?.args[0]).toMatchObject({
      p_job_id: JOB_ID,
      p_claim: CLAIM,
      p_result: { usage: { model: MODEL, input_tokens: 900, output_tokens: 300 } },
    });
    // The first set_asset_text call stores the slide count; one call per kind follows.
    const written = rpcCalls(db, "set_asset_text")
      .map((call) => call.args[0])
      .filter((args) => z.object({ p_alt_text: z.string() }).safeParse(args).success);
    expect(written).toHaveLength(4);
    expect(written[0]).toMatchObject({ p_meta: { caption_lint: "passed" } });
    expect(stubCalls()).toHaveLength(1);
    expect(network).not.toHaveBeenCalled();
  }, 30_000);

  it("a job whose claim is lost is skipped and the next one runs", async () => {
    const other = "3f2a9c1d-0000-4000-8000-0000000000ab";
    const db = runnerDb({
      jobs: [other, JOB_ID],
      claim: (id) => (id === other ? [] : [claimRow(id, DATA)]),
    });
    const lines: string[] = [];
    await runCaptionJobs(db, (line) => lines.push(line));
    expect(lines).toEqual([`write_captions ${JOB_ID} done`]);
    expect(rpcCalls(db, "claim_job")).toHaveLength(2);
    expect(rpcCalls(db, "finish_job")).toHaveLength(1);
  });

  it("30 queued jobs make exactly 25 claims in one run", async () => {
    const ids = Array.from(
      { length: 30 },
      (_, n) => `3f2a9c1d-0000-4000-8000-2${String(n).padStart(11, "0")}`,
    );
    const db = runnerDb({ jobs: ids, claim: () => [] });
    await runCaptionJobs(db, () => undefined);
    expect(rpcCalls(db, "claim_job")).toHaveLength(25);
  });

  it("a CAPTIONS_CLI that does not exist exits 2 and claims nothing", async () => {
    vi.stubEnv("CAPTIONS_CLI", "no-such-caption-cli");
    const db = fakeDb();
    const lines: string[] = [];
    expect(await runCaptionJobs(db, (line) => lines.push(line))).toBe(2);
    expect(lines).toEqual(["caption CLI not found: no-such-caption-cli"]);
    expect(db.calls).toEqual([]);
  });

  it("a CLI that answers an error fails the job for a retry", async () => {
    vi.stubEnv("CAPTIONS_STUB_MODE", "error");
    const db = runnerDb();
    const lines: string[] = [];
    await runCaptionJobs(db, (line) => lines.push(line));
    expect(lines).toEqual([`write_captions ${JOB_ID} failed`]);
    expect(rpcCalls(db, "fail_job")[0]?.args[0]).toMatchObject({
      p_job_id: JOB_ID,
      p_error: "caption CLI exited with code 1",
      p_dead: false,
    });
  }, 30_000);

  it("a job that no retry can fix ends dead", async () => {
    const db = runnerDb({ payload: { params: {}, data: {} } });
    const lines: string[] = [];
    await runCaptionJobs(db, (line) => lines.push(line));
    expect(lines).toEqual([`write_captions ${JOB_ID} dead`]);
    expect(rpcCalls(db, "fail_job")[0]?.args[0]).toMatchObject({
      p_error: "property_id_missing",
      p_dead: true,
    });
  });

  it("a property whose variants are not ready is requeued without the CLI", async () => {
    const db = runnerDb({ media: [stagedRow(0)] });
    const lines: string[] = [];
    await runCaptionJobs(db, (line) => lines.push(line));
    expect(lines).toEqual([`write_captions ${JOB_ID} retry_at`]);
    expect(rpcCalls(db, "requeue_job")).toHaveLength(1);
  });
});
