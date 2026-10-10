// The database side of H1's writing probes (`rate-probe.ts`, `upload-probe.ts`): one `pg` connection to DEV_DB_URL that
// holds the writer lock of G34 for the probe's whole run and removes the rows the probe committed by H1's cleanup rule:
// one transaction that sets `mop.retention` (B2's `refuse_hard_delete()` and B8's append-only triggers refuse a delete
// without it), table by table, children first. A failed cleanup throws `cleanup failed <table> <ids>`.
import pg from "pg";

const LOCK = "hashtext('mop-dev-tests')";
const CLEANUP_ORDER = [
  "submission_media",
  "submissions",
  "contacts",
  "subscribers",
  "inquiries",
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

/** The writer lock stayed with another client for the whole wait. */
export class LockBusy extends Error {}

/**
 * Connects, waits for the writer lock and returns the connection; `close` releases the lock. With `waitMs` the wait
 * ends after that long with `LockBusy`, and without it the call waits for as long as another client holds the lock.
 */
export async function openProbeDb(dbUrl: string, waitMs?: number): Promise<ProbeDb> {
  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();
  if (waitMs === undefined) {
    await client.query(`select pg_advisory_lock(${LOCK})`);
  } else {
    const deadline = Date.now() + waitMs;
    for (;;) {
      const got = await client.query<{ got: boolean }>(
        `select pg_try_advisory_lock(${LOCK}) as got`,
      );
      if (got.rows[0]?.got === true) break;
      if (Date.now() > deadline) {
        await client.end();
        throw new LockBusy(`another client held the writer lock for ${String(waitMs / 1000)} s`);
      }
      await new Promise((done) => setTimeout(done, 1000));
    }
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
