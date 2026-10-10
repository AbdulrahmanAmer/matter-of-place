// What the retention, rotation and incident drills (H1-36, H1-38, H1-39) share: the job runner nudge, the wait for a
// system job, and the throwaway agent keys of the dev agent that `scripts/seed-admin-users.ts` seeds. Every function
// works on the `ProbeDb` connection of `probe-db.ts`, which holds the writer lock (G34) and runs the cleanup.
import { parseArgs } from "node:util";
import { z } from "zod";
import { generateKey, hashAgentKey } from "../../src/server/lib/agent-keys.ts";
import { devProject } from "../lib/storage-env.ts";
import type { ProbeDb } from "./probe-db.ts";

const AGENT_EMAIL = "seed-agent@matterofplace.invalid";
const JOB_WAIT_MS = 90_000;
const POLL_MS = 3000;
const TIMEOUT_MS = 60_000;

/** The `--base` of a drill started with `--env dev`, or null after printing the usage line. */
export function drillBase(script: string): string | null {
  const { values } = parseArgs({ options: { env: { type: "string" }, base: { type: "string" } } });
  const base = values.base?.replace(/\/+$/, "");
  if (values.env === "dev" && base !== undefined && URL.canParse(base)) return base;
  console.error(`usage: bun run scripts/harden/${script} --env dev --base <url>`);
  return null;
}

export interface DrillKey {
  id: string;
  key: string;
}

/** Asks the job runner of the project to take its due jobs now; throws when `JOB_RUNNER_SECRET` is unset (the dev profile exports it) or the runner does not answer 2xx. */
export async function askRunner(): Promise<void> {
  const secret = process.env["JOB_RUNNER_SECRET"];
  if (secret === undefined || secret === "") {
    throw new Error("job runner: JOB_RUNNER_SECRET is not set, load the dev profile first");
  }
  const runner = new URL("/functions/v1/job-runner", devProject().url);
  const headers = new Headers({ "content-type": "application/json" });
  headers.set("authorization", `Bearer ${secret}`);
  const answer = await fetch(runner, {
    method: "POST",
    headers,
    body: "{}",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  await answer.body?.cancel();
  if (!answer.ok)
    throw new Error(`job runner: POST /functions/v1/job-runner answered ${String(answer.status)}`);
}

/** Enqueues a job through `enqueue_job` and returns its id; a key that already exists answers no id and throws. */
export async function enqueue(
  db: ProbeDb,
  type: string,
  payload: unknown,
  key: string,
): Promise<string> {
  const [row] = await db.rows(
    "select public.enqueue_job(p_type => $1, p_payload => $2::jsonb, p_idempotency_key => $3)::text as id",
    [type, JSON.stringify(payload), key],
  );
  const id = row?.["id"];
  if (id === null || id === undefined) throw new Error(`enqueue_job answered no job for ${key}`);
  return id;
}

/** Polls the job to `done` for up to 90 seconds and returns its result; any other end throws `<prefix>: <type> <status>`. */
export async function waitForDone(
  db: ProbeDb,
  jobId: string,
  type: string,
  prefix: string,
): Promise<unknown> {
  const deadline = Date.now() + JOB_WAIT_MS;
  let status = "missing";
  while (Date.now() < deadline) {
    const [row] = await db.rows(
      "select status::text as status, result::text as result from jobs where id = $1",
      [jobId],
    );
    status = row?.["status"] ?? "missing";
    if (status === "done") return z.unknown().parse(JSON.parse(row?.["result"] ?? "null"));
    if (status === "dead") break;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  throw new Error(`${prefix}: ${type} ${status}`);
}

/** The ids of the rows a query selects, for the cleanup lists. */
export async function idsOf(db: ProbeDb, text: string, params: unknown[]): Promise<string[]> {
  return (await db.rows(text, params)).flatMap((row) => {
    const id = row["id"];
    return id === null || id === undefined ? [] : [id];
  });
}

/** Inserts one live key for the seeded dev agent, with the scopes of the agent's newest key, as `rotation-drill.ts` and `incident-drill.ts` do. */
export async function insertAgentKey(db: ProbeDb, label: string): Promise<DrillKey> {
  const [agent] = await db.rows(
    `select u.id::text as user_id,
       (select to_json(k.scopes)::text from public.agent_keys k where k.user_id = u.id order by k.created_at desc limit 1) as scopes
     from auth.users u where lower(u.email) = $1`,
    [AGENT_EMAIL],
  );
  if (agent?.["user_id"] === undefined || agent["scopes"] === null) {
    throw new Error(`${AGENT_EMAIL} has no key: run scripts/seed-admin-users.ts first`);
  }
  const key = generateKey("dev");
  const [row] = await db.rows(
    `insert into public.agent_keys (user_id, key_hash, label, scopes)
     values ($1, $2, $3, array(select jsonb_array_elements_text($4::jsonb)))
     returning id::text as id`,
    [agent["user_id"], await hashAgentKey(key), label, agent["scopes"]],
  );
  const id = row?.["id"];
  if (id === null || id === undefined) throw new Error("the agent_keys insert returned no id");
  return { id, key };
}

/** Sets `revoked_at`, the column B7's revoke action writes. */
export async function revokeAgentKey(db: ProbeDb, id: string): Promise<void> {
  await db.rows("update public.agent_keys set revoked_at = now() where id = $1", [id]);
}

/** Deletes the throwaway key row, so a drill leaves no `agent_keys` row behind. */
export async function deleteAgentKey(db: ProbeDb, id: string): Promise<void> {
  await db.rows("delete from public.agent_keys where id = $1", [id]);
}

/** The status `GET <base>/api/admin/me` answers for a bearer key. */
export async function meStatus(base: string, key: string): Promise<number> {
  const response = await fetch(`${base}/api/admin/me`, {
    headers: { authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  await response.body?.cancel();
  return response.status;
}
