import type { Db } from "../../lib/db.ts";
import { AppError } from "../../lib/errors.ts";
import type { SystemJobDefinition } from "../types.ts";
import { isDryRun, readPolicies } from "./policies.ts";

// The daily prune (architecture 13 rule 8): finished jobs after the jobs_done period, then B3's rate-limit hits and
// webhook receipts after theirs (G16). Every period is the policy row's keep_for.

function unavailable(fn: string): AppError {
  return new AppError("unavailable", undefined, `The job system did not answer (${fn}).`);
}

async function deleteRows(db: Db, key: string, dryRun: boolean): Promise<number> {
  const { data, error } = await db.rpc("retention_delete_rows", { p_key: key, p_dry_run: dryRun });
  if (error !== null) throw unavailable("retention_delete_rows");
  return data;
}

export const prune: SystemJobDefinition = {
  type: "prune",
  async run(ctx, params) {
    const dryRun = isDryRun(params);
    const policies = await readPolicies(ctx.db, ["jobs_done"]);
    const jobsDone = policies.get("jobs_done");
    let jobs = 0;
    if (jobsDone !== undefined) {
      const { data, error } = await ctx.db.rpc("prune_jobs", {
        p_keep: jobsDone.keepFor,
        p_dry_run: dryRun,
      });
      if (error !== null) throw unavailable("prune_jobs");
      jobs = data;
    }
    const rateLimits = await deleteRows(ctx.db, "rate_limits", dryRun);
    const webhookReceipts = await deleteRows(ctx.db, "webhook_receipts", dryRun);
    return {
      status: "done",
      result: {
        dry_run: dryRun,
        jobs_done: jobs,
        rate_limits: rateLimits,
        webhook_receipts: webhookReceipts,
      },
    };
  },
};
