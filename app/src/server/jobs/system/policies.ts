import type { Db } from "../../lib/db.ts";
import { AppError } from "../../lib/errors.ts";

// The retention_policies rows a system job runs by (B2's table, G43): every period comes from `keep_for`, so changing
// one is a data edit, not a deploy.

export interface Policy {
  keepFor: string;
  action: string;
}

/** The enabled rows among `keys` that have a period, by key; a row that is absent, disabled or kept forever is left out. */
export async function readPolicies(db: Db, keys: readonly string[]): Promise<Map<string, Policy>> {
  const { data, error } = await db
    .from("retention_policies")
    .select("key, keep_for, action, enabled")
    .in("key", [...keys]);
  if (error !== null) {
    throw new AppError(
      "unavailable",
      undefined,
      "The job system did not answer (retention_policies).",
    );
  }
  const policies = new Map<string, Policy>();
  for (const row of data) {
    if (row.enabled && row.keep_for !== null) {
      policies.set(row.key, { keepFor: row.keep_for, action: row.action });
    }
  }
  return policies;
}

/** `params.dry_run` of a retention or prune job: counts only, changes nothing. */
export function isDryRun(params: unknown): boolean {
  return typeof params === "object" && params !== null && Reflect.get(params, "dry_run") === true;
}
