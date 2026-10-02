// The database test harness (F22): every database test runs inside one rolled-back transaction on the database named
// by DEV_DB_URL (mop-dev on the laptop, the ephemeral stack in CI's `db` job, T-01). B4 extends it, never replaces it.
import { randomUUID } from "node:crypto";
import pg from "pg";
import { assertNotProduction } from "../../scripts/lib/assert-not-production.mjs";

export type Db = pg.Client;
type Body<T> = (db: Db) => Promise<T>;
type DbRole = "anon" | "authenticated" | "service_role";

// G34: one writer at a time on mop-dev; seeds, fixture loads and drills take the same lock.
const LOCK_KEY = "hashtext('mop-dev-tests')";

function dbUrl(): string {
  const url = process.env["DEV_DB_URL"];
  if (url === undefined || url === "") throw new Error("refusing: DEV_DB_URL is not set");
  return url;
}

async function connect(): Promise<Db> {
  const client = new pg.Client({ connectionString: dbUrl() });
  await client.connect();
  return client;
}

/**
 * Runs `fn` inside a transaction that is always rolled back. MOP_MUTATION_SQL, when set, runs first in the same
 * transaction: that is how a registered `sql` mutation is replayed without editing a test (T-07).
 */
export async function withRollback<T>(fn: Body<T>): Promise<T> {
  const client = await connect();
  try {
    await client.query("begin");
    const mutation = process.env["MOP_MUTATION_SQL"];
    if (mutation !== undefined && mutation !== "") await client.query(mutation);
    return await fn(client);
  } finally {
    try {
      await client.query("rollback");
    } finally {
      await client.end();
    }
  }
}

/** `withRollback` that first runs `sql` (DDL is transactional, so nothing persists, T-07). */
export function withMutation<T>(sql: string, fn: Body<T>): Promise<T> {
  return withRollback(async (db) => {
    await db.query(sql);
    return fn(db);
  });
}

/** The transaction's `now()`; every timestamp a database test writes is relative to it (T-08). */
export async function dbNow(db: Db): Promise<Date> {
  const result = await db.query<{ now: Date }>("select now() as now");
  const row = result.rows[0];
  if (row === undefined) throw new Error("select now() returned no row");
  return row.now;
}

/**
 * Commits, for the few tests that need committed rows across connections. `cleanup` is mandatory and runs in the
 * same `finally` that releases the lock. Refuses a production database before any write (invariant 23, ruling H35).
 */
export async function committed<T>(fn: Body<T>, cleanup: Body<void> | undefined): Promise<T> {
  if (cleanup === undefined) throw new Error("committed() needs a cleanup");
  await assertNotProduction({ dbUrl: dbUrl() });
  // B4 sets MOP_DEV_LOCK_HELD for a child of a run that already holds the lock.
  const takeLock = process.env["MOP_DEV_LOCK_HELD"] !== "1";
  const client = await connect();
  try {
    if (takeLock) await client.query(`select pg_advisory_lock(${LOCK_KEY})`);
    try {
      return await fn(client);
    } finally {
      await cleanup(client);
    }
  } finally {
    try {
      if (takeLock) await client.query(`select pg_advisory_unlock(${LOCK_KEY})`);
    } finally {
      await client.end();
    }
  }
}

/** A row in `auth.users`, inside the caller's transaction; no auth admin API. */
export async function createAuthUser(db: Db): Promise<string> {
  const id = randomUUID();
  await db.query(
    `insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
     values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, now(), now())`,
    [id, `test-${id}@example.test`],
  );
  return id;
}

/** An auth user holding `roles`. */
export async function createStaffUser(db: Db, roles: string[]): Promise<string> {
  const id = await createAuthUser(db);
  await db.query(
    "insert into public.user_roles (user_id, role) select $1, unnest($2::public.app_role[])",
    [id, roles],
  );
  return id;
}

/**
 * Switches the transaction to `role`, so an assertion "as the service role" runs as that role and not as `postgres`,
 * the owner of every function. `authenticated` acts as `userId` through the JWT claims `auth.uid()` reads.
 */
export async function asRole(db: Db, role: DbRole, userId?: string): Promise<void> {
  await db.query(`set local role ${role}`);
  if (userId !== undefined) {
    await db.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: userId }),
    ]);
  }
}
