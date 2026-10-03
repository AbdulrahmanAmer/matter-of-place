import pg from "pg";

// G34: one writer at a time on mop-dev. The key is the one `committed` in db.ts takes.
const LOCK = "hashtext('mop-dev-tests')";

/**
 * Takes the session advisory lock `mop-dev-tests` on one connection to `DEV_DB_URL` and returns the function that
 * releases it. A no-op when `MOP_DEV_LOCK_HELD=1`: the parent that spawned this process already holds the lock.
 */
export async function holdDevLock(): Promise<() => Promise<void>> {
  if (process.env["MOP_DEV_LOCK_HELD"] === "1") return () => Promise.resolve();
  const url = process.env["DEV_DB_URL"];
  if (url === undefined || url === "") throw new Error("refusing: DEV_DB_URL is not set");
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  await client.query(`select pg_advisory_lock(${LOCK})`);
  process.stdout.write("lock mop-dev-tests held\n");
  return async () => {
    try {
      await client.query(`select pg_advisory_unlock(${LOCK})`);
    } finally {
      await client.end();
    }
  };
}
