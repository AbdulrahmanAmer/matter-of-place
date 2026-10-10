// `bun run scripts/harden/health-drill.ts` (H1-34), with the dev profile loaded: the daily health job fails loudly when a
// check is forced to fail. It enqueues a `health` system job with `params.force_fail = "dead_jobs_24h"` (B8), asks the
// runner and waits up to 90 seconds for `done`, then asserts that the job's result lists that check as `fail`, that one
// `health.failed` event was written after the drill started, and that B8b's recipe `notify_admin_health` made one
// `notify_admin` job for it. The runner fans an event out at the start of a later tick, so it is asked a second time
// and the job is awaited for up to 90 seconds more; a timeout prints `health drill: no notify_admin` and exits 1. With
// `SENTRY_AUTH_TOKEN` it also finds the Sentry issue `HealthCheckFailed: dead_jobs_24h` seen after the start (INT-04).
// It commits rows to the one database, so it refuses production first (ruling H35 (5)), holds the writer lock (G34) and
// removes its rows by H1's cleanup rule. Prints `health drill ok`, or the failing check and exit 1.
import { z } from "zod";
import { assertNotProduction } from "../lib/assert-not-production.mjs";
import { askRunner, ids, openProbeDb, type ProbeDb } from "./probe-db.ts";
import { sentryGet, sentryToken } from "./sentry-api.ts";

const CHECK = "dead_jobs_24h";
const WAIT_MS = 90_000;
const SENTRY_WAIT_MS = 120_000;
const POLL_MS = 3000;

const result = z.object({ checks: z.array(z.object({ name: z.string(), status: z.string() })) });
const sentryIssues = z.array(z.object({ title: z.string(), lastSeen: z.string() }));

/** Calls `read` until it answers a value or `limitMs` passes; undefined on a timeout. */
async function until<T>(
  limitMs: number,
  read: () => Promise<T | undefined>,
): Promise<T | undefined> {
  const deadline = Date.now() + limitMs;
  for (;;) {
    const value = await read();
    if (value !== undefined) return value;
    if (Date.now() >= deadline) return undefined;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

async function healthJob(db: ProbeDb, jobId: string): Promise<z.infer<typeof result>> {
  await askRunner();
  const settled = await until(WAIT_MS, async () => {
    const [row] = await db.rows(
      "select status::text as status, result::text as result from jobs where id = $1",
      [jobId],
    );
    if (row?.["status"] === "dead") throw new Error(`health drill: the health job is dead`);
    return row?.["status"] === "done"
      ? result.parse(JSON.parse(row["result"] ?? "null"))
      : undefined;
  });
  if (settled === undefined)
    throw new Error(
      `health drill: the health job was not done in ${String(WAIT_MS / 1000)} seconds`,
    );
  return settled;
}

async function notifyJobs(db: ProbeDb, eventId: string): Promise<string[]> {
  await askRunner();
  const found = await until(WAIT_MS, async () => {
    const jobs = await ids(
      db,
      "select id::text as id from jobs where type = 'notify_admin' and event_id = $1",
      [eventId],
    );
    return jobs.length === 0 ? undefined : jobs;
  });
  if (found === undefined) throw new Error("health drill: no notify_admin");
  if (found.length !== 1)
    throw new Error(`health drill: ${String(found.length)} notify_admin jobs for the event, not 1`);
  return found;
}

async function sentryIssue(token: string, start: string): Promise<void> {
  const seen = await until(SENTRY_WAIT_MS, async () => {
    const found = await sentryGet(token, "issues/?query=HealthCheckFailed", sentryIssues);
    return found.some(
      (issue) =>
        issue.title.endsWith(`HealthCheckFailed: ${CHECK}`) &&
        Date.parse(issue.lastSeen) >= Date.parse(start),
    )
      ? true
      : undefined;
  });
  if (seen === undefined)
    throw new Error(
      `health drill: no Sentry issue HealthCheckFailed: ${CHECK} seen after the start`,
    );
}

async function cleanup(
  db: ProbeDb,
  jobId: string | undefined,
  eventId: string | undefined,
): Promise<void> {
  try {
    const events = eventId === undefined ? [] : [eventId];
    const jobs = [
      ...(jobId === undefined ? [] : [jobId]),
      ...(await ids(db, "select id::text as id from jobs where event_id::text = any($1::text[])", [
        events,
      ])),
    ];
    await db.cleanup({
      job_events: await ids(
        db,
        "select id::text as id from job_events where job_id::text = any($1::text[])",
        [jobs],
      ),
      jobs,
      events,
    });
  } finally {
    await db.close();
  }
}

async function main(): Promise<number> {
  const dbUrl = process.env["DEV_DB_URL"];
  await assertNotProduction({ dbUrl });
  const db = await openProbeDb(dbUrl ?? "");
  const start = await db.now();
  let jobId: string | undefined;
  let eventId: string | undefined;
  try {
    [jobId] = await ids(
      db,
      "select public.enqueue_job(p_type => 'health', p_payload => $1::jsonb, p_idempotency_key => $2)::text as id",
      [
        JSON.stringify({ params: { force_fail: CHECK }, data: {} }),
        `health:h1-drill-${Date.now().toString()}`,
      ],
    );
    if (jobId === undefined) throw new Error("health drill: enqueue_job answered no job");
    const checks = (await healthJob(db, jobId)).checks;
    if (checks.find((check) => check.name === CHECK)?.status !== "fail") {
      throw new Error(`health drill: the result does not list ${CHECK} as fail`);
    }
    [eventId] = await ids(
      db,
      "select id::text as id from events where type = 'health.failed' and at > $1 order by at desc limit 1",
      [start],
    );
    if (eventId === undefined) throw new Error("health drill: no health.failed event was written");
    await notifyJobs(db, eventId);
    const token = sentryToken();
    if (token !== undefined) await sentryIssue(token, start);
    console.log(
      `health drill ok (${CHECK} failed, event ${eventId}, one notify_admin job${token === undefined ? "; Sentry not checked: SENTRY_AUTH_TOKEN is unset" : ", Sentry issue seen"})`,
    );
    return 0;
  } finally {
    await cleanup(db, jobId, eventId);
  }
}

try {
  process.exitCode = await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
