// B9 step 9, ASSUMED H34 (3): the caption runner, run with bun on the operator's laptop (`bun run captions`). It claims
// the `write_captions` jobs the job runner never touches, writes each through the headless Claude CLI named by
// `CAPTIONS_CLI` (default `claude`) and settles the job like B8's runner does. It stops when no job is due or after
// 25 jobs, and prints one line per job. It prints no secret and no prompt.
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database, Json } from "../src/db/index.ts";
import type { Completion } from "../src/server/assets/captions.ts";
import type { ClaimedJob } from "../src/server/jobs/claim.ts";
import { claimJob, failJob, finishJob, requeueJob } from "../src/server/jobs/claim.ts";
import {
  runWriteCaptions,
  writeCaptionsStep,
  type CliComplete,
} from "../src/server/jobs/steps/write-captions.ts";
import type { JsonObject, StepContext } from "../src/server/jobs/types.ts";
import { NonRetryableError } from "../src/server/jobs/types.ts";
import type { Db } from "../src/server/lib/db.ts";
import { logLine } from "../src/server/lib/log.ts";

const MAX_JOBS_PER_RUN = 25;
// A call to the CLI ends inside two minutes, so the two calls of one job (the answer and the lint retry) end well
// inside B8's five minute lease.
const CLI_TIMEOUT_MS = 120_000;
const JOB_BUDGET_MS = 270_000;
const ENV_FILE_NAMES = [
  "DEV_SUPABASE_PROJECT_REF",
  "DEV_SUPABASE_SERVICE_ROLE_KEY",
  "CAPTIONS_CLI",
  "MEDIA_PUBLIC_BASE",
];

const cliAnswer = z.object({
  is_error: z.boolean().optional(),
  result: z.string(),
  usage: z.object({ input_tokens: z.number(), output_tokens: z.number() }),
});

const isJsonObject = (value: Json | undefined): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The program of `CAPTIONS_CLI` and its leading arguments, so a test can name `bun tests/fixtures/claude-stub.ts`. */
function cliCommand(): { name: string; program: string; lead: string[] } {
  const configured = process.env["CAPTIONS_CLI"]?.trim();
  const name = configured === undefined || configured === "" ? "claude" : configured;
  const [program = "claude", ...lead] = name.split(/\s+/);
  return { name, program, lead };
}

function runCli(
  args: string[],
  stdin: string,
  signal: AbortSignal,
): Promise<{ code: number | null; stdout: string }> {
  const { program, lead } = cliCommand();
  return new Promise((resolve, reject) => {
    const child = spawn(program, [...lead, ...args], {
      signal,
      windowsHide: true,
      stdio: ["pipe", "pipe", "ignore"],
    });
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stdin.on("error", reject);
    child.on("error", (error) => {
      reject(new Error(`caption CLI did not run: ${error.message}`));
    });
    child.on("close", (code) => {
      resolve({ code, stdout });
    });
    child.stdin.end(stdin);
  });
}

/** The name of the CLI when it does not answer `--version`, else null. */
export async function cliMissing(): Promise<string | null> {
  const probe = await runCli(["--version"], "", AbortSignal.timeout(CLI_TIMEOUT_MS)).catch(() => ({
    code: 1,
    stdout: "",
  }));
  return probe.code === 0 ? null : cliCommand().name;
}

/** One answer of the CLI. The prompt goes to its stdin and never among its arguments (H34 (3)). */
export async function runClaudeCli(
  prompt: string,
  model: string,
  signal: AbortSignal,
): Promise<Completion> {
  const run = await runCli(
    ["-p", "--model", model, "--output-format", "json"],
    prompt,
    AbortSignal.any([signal, AbortSignal.timeout(CLI_TIMEOUT_MS)]),
  );
  if (run.code !== 0) throw new Error(`caption CLI exited with code ${String(run.code)}`);
  let raw: unknown;
  try {
    raw = JSON.parse(run.stdout);
  } catch {
    throw new Error("caption CLI answer is not JSON");
  }
  const answer = cliAnswer.safeParse(raw);
  if (!answer.success) throw new Error("caption CLI answer is not the result object");
  if (answer.data.is_error === true) throw new Error("caption CLI answered an error");
  return { text: answer.data.result, usage: answer.data.usage };
}

type Outcome = "done" | "retry_at" | "failed" | "dead" | "lost";

async function runJob(db: Db, job: ClaimedJob, complete: CliComplete): Promise<Outcome> {
  const ids = { jobId: job.id, claim: job.claim };
  const ctx: StepContext = {
    db,
    env: process.env,
    log: logLine,
    now: new Date(),
    signal: AbortSignal.timeout(JOB_BUDGET_MS),
    report: () => Promise.resolve(),
    job: {
      id: job.id,
      type: job.type,
      attempts: job.attempts,
      claim: job.claim,
      result: job.result,
      eventId: job.event_id,
    },
  };
  try {
    const payload = isJsonObject(job.payload) ? job.payload : {};
    const data = payload["data"];
    const params = writeCaptionsStep.paramsSchema.safeParse(payload["params"] ?? {});
    if (!params.success) throw new NonRetryableError("invalid_params");
    const result = await runWriteCaptions(
      ctx,
      params.data,
      isJsonObject(data) ? data : {},
      complete,
    );
    if (result.status === "retry_at") {
      const moved = await requeueJob(db, {
        ...ids,
        runAfter: result.at,
        kind: "requeued",
        result: result.result,
      });
      return moved ? "retry_at" : "lost";
    }
    return (await finishJob(db, { ...ids, result: result.result })) ? "done" : "lost";
  } catch (error) {
    const dead = error instanceof NonRetryableError;
    const changed = await failJob(db, {
      ...ids,
      error: error instanceof Error ? error.message : String(error),
      dead,
    });
    if (!changed) return "lost";
    return dead || job.attempts + 1 >= job.max_attempts ? "dead" : "failed";
  }
}

/** The jobs due now, oldest first (B8's partial index on `run_local`). */
async function dueJobIds(db: Db): Promise<string[]> {
  const { data, error } = await db
    .from("jobs")
    .select("id")
    .eq("run_local", true)
    .eq("type", writeCaptionsStep.type)
    .in("status", ["queued", "failed"])
    .lte("run_after", new Date().toISOString())
    .order("created_at")
    .limit(MAX_JOBS_PER_RUN);
  if (error !== null) throw new Error(`captions: reading jobs failed: ${error.message}`);
  return data.map((row) => row.id);
}

/**
 * One run. Returns the exit code: 2 when the CLI does not answer `--version` (nothing is claimed), else 0. A job whose
 * claim is lost moves on to the next.
 */
export async function runCaptionJobs(
  db: Db,
  print: (line: string) => void,
  complete: CliComplete = runClaudeCli,
): Promise<number> {
  const missing = await cliMissing();
  if (missing !== null) {
    print(`caption CLI not found: ${missing}`);
    return 2;
  }
  for (const id of (await dueJobIds(db)).slice(0, MAX_JOBS_PER_RUN)) {
    const job = await claimJob(db, { jobId: id });
    if (job === null) continue;
    print(`${writeCaptionsStep.type} ${job.id} ${await runJob(db, job, complete)}`);
  }
  return 0;
}

/** The names of one allow-list from the repository's git-ignored `.env`, without overriding the shell. */
function loadEnvFile(): void {
  const file = new URL("../../.env", import.meta.url);
  if (!existsSync(file)) return;
  const values = parseEnv(readFileSync(file, "utf8"));
  for (const name of ENV_FILE_NAMES) {
    const value = values[name];
    if (process.env[name] === undefined && value !== undefined) process.env[name] = value;
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`captions: ${name} is not set`);
  return value;
}

/** The service-role client of the one project (H35), built from the `.env` names and never printed. */
export function captionsDb(): Db {
  loadEnvFile();
  return createClient<Database>(
    `https://${requiredEnv("DEV_SUPABASE_PROJECT_REF")}.supabase.co`,
    requiredEnv("DEV_SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

async function main(): Promise<void> {
  process.exitCode = await runCaptionJobs(captionsDb(), console.log);
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
