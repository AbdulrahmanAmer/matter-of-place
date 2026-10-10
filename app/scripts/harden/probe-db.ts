// The database side of H1's writing probes (`rate-probe.ts`, `upload-probe.ts`): one `pg` connection to DEV_DB_URL that
// holds the writer lock of G34 for the probe's whole run and removes the rows the probe committed by H1's cleanup rule:
// one transaction that sets `mop.retention` (B2's `refuse_hard_delete()` and B8's append-only triggers refuse a delete
// without it), table by table, children first. A failed cleanup throws `cleanup failed <table> <ids>`.
import pg from "pg";
import { devProject } from "../lib/storage-env.ts";
import { readSecret } from "../lib/social-script.ts";

const LOCK = "hashtext('mop-dev-tests')";
// The pooler cancels a statement after about two minutes (statement_timeout), and other lanes hold the lock for longer
// than that, so the lock is polled with short queries instead of waited for in one blocking call.
const LOCK_POLL_MS = 3000;
const LOCK_WAIT_MS = 30 * 60_000;
const CLEANUP_ORDER = [
  "submission_media",
  "submissions",
  "contacts",
  "subscribers",
  "inquiries",
  "email_messages",
  "job_events",
  "jobs",
  "events",
  "assets",
  "rate_limits",
] as const;

export type ProbeTable = (typeof CLEANUP_ORDER)[number];
export type ProbeRows = Partial<Record<ProbeTable, readonly string[]>>;

export interface ProbeDb {
  /** The rows of one query; the probes cast every column they read to text. */
  rows: (text: string, params?: unknown[]) => Promise<Record<string, string | null>[]>;
  /** The database's clock as ISO 8601, the start a probe's cleanup and reconcile read from. */
  now: () => Promise<string>;
  cleanup: (rows: ProbeRows) => Promise<void>;
  close: () => Promise<void>;
}

/** The `id` column of every row a query returns. */
export async function ids(db: ProbeDb, text: string, params: unknown[]): Promise<string[]> {
  return (await db.rows(text, params)).flatMap((row) =>
    row["id"] === null || row["id"] === undefined ? [] : [row["id"]],
  );
}

/** Asks the deployed job runner for a tick when `JOB_RUNNER_SECRET` is set; otherwise its minute tick takes the job. */
export async function askRunner(): Promise<void> {
  const secret = readSecret("JOB_RUNNER_SECRET");
  if (secret === undefined) return;
  const response = await fetch(`${devProject().url}/functions/v1/job-runner`, {
    method: "POST",
    headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
    body: "{}",
    signal: AbortSignal.timeout(60_000),
  });
  await response.body?.cancel();
}

async function takeLock(client: pg.Client): Promise<void> {
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    const result = await client.query<{ got: boolean }>(
      `select pg_try_advisory_lock(${LOCK}) as got`,
    );
    if (result.rows[0]?.got === true) return;
    if (Date.now() >= deadline) {
      throw new Error("probe-db: the mop-dev-tests lock was not free within 30 minutes");
    }
    await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_MS));
  }
}

/** Connects, waits for the writer lock and returns the connection; `close` releases the lock. */
export async function openProbeDb(dbUrl: string): Promise<ProbeDb> {
  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();
  try {
    await takeLock(client);
  } catch (error) {
    await client.end();
    throw error;
  }
  const rows = async (text: string, params: unknown[] = []) => {
    const result = await client.query<Record<string, string | null>>(text, params);
    return result.rows;
  };
  const now = async () => {
    const [row] = await rows("select to_json(now()) #>> '{}' as now");
    const value = row?.["now"];
    if (value === null || value === undefined)
      throw new Error("probe-db: the database gave no time");
    return value;
  };
  const cleanup = async (found: ProbeRows) => {
    await client.query("begin");
    await client.query("select set_config('mop.retention', 'on', true)");
    for (const table of CLEANUP_ORDER) {
      const ids = found[table] ?? [];
      if (ids.length === 0) continue;
      try {
        await client.query(`delete from public.${table} where id::text = any($1::text[])`, [ids]);
      } catch (error) {
        await client.query("rollback");
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`cleanup failed ${table} ${ids.join(",")}: ${reason}`);
      }
    }
    await client.query("commit");
  };
  const close = async () => {
    try {
      await client.query(`select pg_advisory_unlock(${LOCK})`);
    } finally {
      await client.end();
    }
  };
  return { rows, now, cleanup, close };
}
