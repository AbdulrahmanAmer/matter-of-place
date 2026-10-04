import type { Json } from "../../db/index.ts";
import type { Db } from "../lib/db.ts";
import { AppError } from "../lib/errors.ts";

/**
 * One `reap_stale_jobs()` call per tick: a light job whose lease is older than 5 minutes fails with
 * `lease_expired` (one attempt used, never a free reset, JOB-02), a heavy job with no callback after 30
 * minutes fails with `callback_timeout`, and lost messages are sent again (invariant 5).
 */
export async function reapStaleJobs(db: Db): Promise<Json> {
  const { data, error } = await db.rpc("reap_stale_jobs");
  if (error !== null) {
    throw new AppError(
      "unavailable",
      undefined,
      "The job system did not answer (reap_stale_jobs).",
    );
  }
  return data;
}
