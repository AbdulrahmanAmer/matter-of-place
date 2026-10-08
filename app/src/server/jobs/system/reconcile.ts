import type { Json } from "../../../db/index.ts";
import { reconcileSocial as settleSocial } from "../../channels/reconcile-social.ts";
import type { Db } from "../../lib/db.ts";
import { AppError } from "../../lib/errors.ts";
import { reconcileUploads as settleUploads } from "../../submissions/reconcile.ts";
import type { JsonObject, StepContext, SystemJobDefinition } from "../types.ts";
import { NonRetryableError } from "../types.ts";

// The 15-minute reconcile job (G10), started only by B8b's reconcile schedule row and by
// `scripts/job-selftest.ts --reconcile`. Each slice that appends a call writes its own key of the result; uploads
// first, then the social part of B10 (`reconcile-social.ts`).

export interface UploadCounts {
  checked: number;
  uploaded: number;
  deleted: number;
  missing: number;
}

export type ReconcileUploads = (db: Db, since: Date) => Promise<UploadCounts>;

export type ReconcileSocial = (
  ctx: StepContext,
  params: Json,
  now: Date,
) => Promise<{ social: Json }>;

const OVERLAP_MS = 15 * 60 * 1000;
const FIRST_RUN_MS = 24 * 60 * 60 * 1000;

/** `data.since` when the job carries it, else the last done run minus 15 minutes, else 24 hours ago. */
async function sinceOf(ctx: StepContext, data: JsonObject): Promise<Date> {
  const given = data["since"];
  if (given !== undefined) {
    const since = typeof given === "string" ? new Date(given) : new Date(Number.NaN);
    if (Number.isNaN(since.getTime())) throw new NonRetryableError("invalid_since");
    return since;
  }
  const { data: last, error } = await ctx.db
    .from("jobs")
    .select("finished_at")
    .eq("type", "reconcile")
    .eq("status", "done")
    .not("finished_at", "is", null)
    .order("finished_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error !== null)
    throw new AppError("unavailable", undefined, "The job system did not answer (jobs).");
  if (last?.finished_at) return new Date(Date.parse(last.finished_at) - OVERLAP_MS);
  return new Date(ctx.now.getTime() - FIRST_RUN_MS);
}

export function reconcileJob(
  reconcileUploads: ReconcileUploads,
  socialPart: ReconcileSocial,
): SystemJobDefinition {
  return {
    type: "reconcile",
    sideEffect: "none",
    async run(ctx, params, data) {
      const uploads = await reconcileUploads(ctx.db, await sinceOf(ctx, data));
      const { social } = await socialPart(ctx, params, ctx.now);
      return { status: "done", result: { uploads: { ...uploads }, social } };
    },
  };
}

export const reconcile = reconcileJob(settleUploads, settleSocial);
