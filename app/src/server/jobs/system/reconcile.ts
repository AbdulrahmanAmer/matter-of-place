import type { Json } from "../../../db/index.ts";
import { reconcileSocial as settleSocial } from "../../channels/reconcile-social.ts";
import type { Db } from "../../lib/db.ts";
import { AppError } from "../../lib/errors.ts";
import { aggregateRecentIssues } from "../../newsletter/metrics.ts";
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
  deferred: number;
}

/** `now` and `deadline` are epoch milliseconds: the clock of the missing-row test and the last moment a row may start. */
export type ReconcileUploads = (
  db: Db,
  since: Date,
  now?: number,
  deadline?: number,
) => Promise<UploadCounts>;

export type ReconcileSocial = (
  ctx: StepContext,
  params: Json,
  now: Date,
) => Promise<{ social: Json }>;

/** B11's issue metrics, refreshed on every run from `email_events`: `{ issues }` refreshed. */
export type AggregateIssues = (db: Db, now: Date) => Promise<{ issues: number }>;

const OVERLAP_MS = 15 * 60 * 1000;
const FIRST_RUN_MS = 24 * 60 * 60 * 1000;
// The upload part starts no row after this; the social and newsletter parts keep the rest of the job's 40 seconds.
const UPLOADS_BUDGET_MS = 20_000;

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
  aggregateIssues: AggregateIssues,
): SystemJobDefinition {
  return {
    type: "reconcile",
    sideEffect: "none",
    timeoutMs: 40_000,
    async run(ctx, params, data) {
      const started = Date.now();
      const since = await sinceOf(ctx, data);
      const uploads = await reconcileUploads(ctx.db, since, started, started + UPLOADS_BUDGET_MS);
      const { social } = await socialPart(ctx, params, ctx.now);
      const newsletter = await aggregateIssues(ctx.db, ctx.now);
      return {
        status: "done",
        result: { uploads: { ...uploads }, social, newsletter: { ...newsletter } },
      };
    },
  };
}

export const reconcile = reconcileJob(settleUploads, settleSocial, aggregateRecentIssues);
