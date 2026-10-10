// `bun run scripts/harden/fail-drill.ts --base <url>` (H1-32), with the dev profile loaded: every failure is visible and
// retryable. Part 4 runs first, because its verdict decides the first output line: a bounced test email needs
// `EMAIL_LIVE=1` on the runner, and while the send is a dry run (or no runner secret is at hand) the drill prints
// `BLOCKED ...` before anything else and goes on. Part 1 makes a dead job (B8's selftest), retries it through the admin
// route with an agent key the drill makes for itself (role media_ops, scope jobs, revoked at the end) and asserts the
// `manual_retry` job event. Parts 2 and 3 rerun the Playwright specs of screens 12 and 16. It commits rows to the one
// database, so it refuses production first (ruling H35 (5)), holds the writer lock for the whole run (children are told
// so by MOP_DEV_LOCK_HELD, G34) and removes its job by H1's cleanup rule. A failing part exits 1, a blocked part 4 does
// not. Prints `fail drill ok` for parts 1 to 3.
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";
import { generateKey, hashAgentKey } from "../../src/server/lib/agent-keys.ts";
import { assertNotProduction } from "../lib/assert-not-production.mjs";
import { devProject } from "../lib/storage-env.ts";
import { readSecret } from "../lib/social-script.ts";
import { ids, openProbeDb, type ProbeDb } from "./probe-db.ts";

const AGENT_EMAIL = "fail-drill-agent@mop.invalid";
const BOUNCE_ADDRESS = "bounced@resend.dev";
const TIMEOUT_MS = 60_000;
const BOUNCE_WAIT_MS = 120_000;
const POLL_MS = 5000;
const TAIL_LINES = 30;
const BLOCKED_EMAIL = "BLOCKED until EMAIL_LIVE=1 on mop-dev (B5 step 5)";

interface Finished {
  code: number;
  output: string;
}

/** Runs a child under the writer lock this process holds; `bun` is on the PATH of every shell that runs the drill. */
function child(args: string[], env: Record<string, string> = {}): Finished {
  const result = spawnSync("bun", args, {
    encoding: "utf8",
    env: { ...process.env, ...env, MOP_DEV_LOCK_HELD: "1" },
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
  return { code: result.status ?? 1, output: `${result.stdout}${result.stderr}` };
}

function tail(output: string): string {
  return output.trim().split("\n").slice(-TAIL_LINES).join("\n");
}

function mustPass(label: string, finished: Finished): string {
  if (finished.code !== 0)
    throw new Error(
      `fail drill: ${label} exited ${String(finished.code)}\n${tail(finished.output)}`,
    );
  return finished.output;
}

/** The last line of a Playwright run, such as `3 passed (41.2s)`. */
function summaryOf(output: string): string {
  return (
    output
      .split("\n")
      .filter((line) => /\d+ passed/.test(line))
      .at(-1)
      ?.trim() ?? "no summary line"
  );
}

async function one(
  db: ProbeDb,
  text: string,
  params: unknown[],
): Promise<Record<string, string | null>> {
  const [row] = await db.rows(text, params);
  if (row === undefined) throw new Error(`fail drill: no row from: ${text}`);
  return row;
}

/** Part 4: a test email to a Resend address that bounces. Returns the line to print. */
async function bouncedEmail(db: ProbeDb): Promise<string> {
  if (readSecret("JOB_RUNNER_SECRET") === undefined) {
    return "BLOCKED JOB_RUNNER_SECRET (part 4 sends through the deployed job runner)";
  }
  mustPass("email-test", child(["run", "scripts/email-test.ts", "received", BOUNCE_ADDRESS]));
  const latest = () =>
    one(
      db,
      "select status::text as status, resend_id from email_messages where to_email = $1 order by created_at desc limit 1",
      [BOUNCE_ADDRESS],
    );
  const first = await latest();
  if (first["status"] === "skipped" && first["resend_id"]?.startsWith("dry_") === true) {
    return BLOCKED_EMAIL;
  }
  const deadline = Date.now() + BOUNCE_WAIT_MS;
  let status = first["status"];
  while (status !== "bounced" && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    status = (await latest())["status"];
  }
  if (status !== "bounced")
    throw new Error(`fail drill: part 4 ended ${status ?? "with no row"}, not bounced`);
  return "bounced";
}

interface DrillAgent {
  key: string;
  keyId: string;
}

/** The auth user, its media_ops agent role and a new key scoped to jobs; the user is reused by later runs. */
async function makeAgent(db: ProbeDb): Promise<DrillAgent> {
  const existing = await ids(db, "select id::text as id from auth.users where lower(email) = $1", [
    AGENT_EMAIL,
  ]);
  const userId = existing[0] ?? (await createUser());
  await db.rows(
    `insert into public.user_roles (user_id, role, actor_kind, display_name)
     values ($1, 'media_ops', 'agent', 'Fail drill agent')
     on conflict (user_id, role) do update set disabled_at = null`,
    [userId],
  );
  const key = generateKey("dev");
  const [keyId] = await ids(
    db,
    "insert into public.agent_keys (user_id, key_hash, label, scopes) values ($1, $2, $3, '{jobs}') returning id::text as id",
    [userId, await hashAgentKey(key), `fail-drill ${new Date().toISOString()}`],
  );
  if (keyId === undefined) throw new Error("fail drill: the agent key was not stored");
  return { key, keyId };
}

async function createUser(): Promise<string> {
  const project = devProject();
  const { data, error } = await createClient(project.url, project.key, {
    auth: { persistSession: false, autoRefreshToken: false },
  }).auth.admin.createUser({ email: AGENT_EMAIL, email_confirm: true });
  if (error !== null)
    throw new Error(`fail drill: creating ${AGENT_EMAIL} failed: ${error.message}`);
  return data.user.id;
}

/** Part 1, first half: B8's selftest makes a dead job; returns its id so the cleanup can find it. */
async function deadJob(db: ProbeDb, start: string): Promise<string> {
  mustPass("job-selftest --fail-light", child(["run", "scripts/job-selftest.ts", "--fail-light"]));
  const [jobId] = await ids(
    db,
    "select id::text as id from jobs where type = 'test.selftest_light' and status = 'dead' and created_at >= $1 order by created_at desc limit 1",
    [start],
  );
  if (jobId === undefined)
    throw new Error("fail drill: part 1 found no dead test.selftest_light job");
  return jobId;
}

/** Part 1, second half: the drill's own agent retries the job through the admin route. */
async function retryAsAgent(
  db: ProbeDb,
  base: string,
  agent: DrillAgent,
  jobId: string,
): Promise<void> {
  const response = await fetch(`${base}/api/admin/jobs/${jobId}/retry`, {
    method: "POST",
    headers: { authorization: `Bearer ${agent.key}`, "content-type": "application/json" },
    body: "{}",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (response.status !== 200) {
    throw new Error(
      `fail drill: the retry answered ${String(response.status)}: ${await response.text()}`,
    );
  }
  const events = await ids(
    db,
    "select id::text as id from job_events where job_id = $1 and kind = 'manual_retry'",
    [jobId],
  );
  if (events.length !== 1) {
    throw new Error(
      `fail drill: job ${jobId} has ${String(events.length)} manual_retry events, not 1`,
    );
  }
  console.log(`part 1: retry answered 200 and job ${jobId} has a manual_retry event`);
}

async function cleanup(
  db: ProbeDb,
  jobId: string | undefined,
  agent: DrillAgent | undefined,
): Promise<void> {
  try {
    if (agent !== undefined) {
      await db.rows("update public.agent_keys set revoked_at = now() where id = $1", [agent.keyId]);
    }
    const jobs = jobId === undefined ? [] : [jobId];
    await db.cleanup({
      job_events: await ids(
        db,
        "select id::text as id from job_events where job_id::text = any($1::text[])",
        [jobs],
      ),
      jobs,
      rate_limits:
        agent === undefined
          ? []
          : await ids(db, "select id::text as id from rate_limits where bucket = $1", [
              `agent:${agent.keyId}`,
            ]),
    });
  } finally {
    await db.close();
  }
}

async function main(): Promise<number> {
  const { values } = parseArgs({ options: { base: { type: "string" } }, strict: true });
  const base = values.base?.replace(/\/+$/, "");
  if (base === undefined || !URL.canParse(base)) {
    console.error("usage: bun run scripts/harden/fail-drill.ts --base <url>");
    return 64;
  }
  const dbUrl = process.env["DEV_DB_URL"];
  await assertNotProduction({ dbUrl });
  const db = await openProbeDb(dbUrl ?? "");
  const start = await db.now();
  let jobId: string | undefined;
  let agent: DrillAgent | undefined;
  try {
    const email = await bouncedEmail(db);
    if (email.startsWith("BLOCKED")) console.log(email);
    agent = await makeAgent(db);
    jobId = await deadJob(db, start);
    await retryAsAgent(db, base, agent, jobId);
    const e2e = { E2E_TARGET: process.env["E2E_TARGET"] ?? "built" };
    console.log(
      `part 2: ${summaryOf(mustPass("admin-channels.spec", child(["x", "playwright", "test", "tests/e2e/admin-channels.spec.ts"], e2e)))}`,
    );
    console.log(
      `part 3: ${summaryOf(mustPass("admin-jobs.spec", child(["x", "playwright", "test", "tests/e2e/admin-jobs.spec.ts"], e2e)))}`,
    );
    if (email === "bounced") console.log(`part 4: bounced ${BOUNCE_ADDRESS}`);
    console.log("fail drill ok (parts 1 to 3)");
    return 0;
  } finally {
    await cleanup(db, jobId, agent);
  }
}

try {
  process.exitCode = await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
