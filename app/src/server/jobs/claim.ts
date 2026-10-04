import type { Database, Json } from "../../db/index.ts";
import type { Db } from "../lib/db.ts";
import { AppError } from "../lib/errors.ts";

// The one caller of claim_job, finish_job, fail_job and requeue_job (R26). Every change after a claim is
// fenced by the claim token in `jobs.locked_by` (JOB-02); each wrapper answers false when the claim no
// longer holds the job, and the SQL function then changed nothing.

type JobRow = Database["public"]["Functions"]["claim_job"]["Returns"][number];
export type ClaimedJob = JobRow & { claim: string };

function unavailable(fn: string): AppError {
  return new AppError("unavailable", undefined, `The job system did not answer (${fn}).`);
}

/** Claims one `queued` or `failed` job by id; null when another run holds it or it is not runnable. */
export async function claimJob(db: Db, { jobId }: { jobId: string }): Promise<ClaimedJob | null> {
  const { data, error } = await db.rpc("claim_job", { p_job_id: jobId });
  if (error !== null) throw unavailable("claim_job");
  const row = data[0];
  if (row === undefined || row.locked_by === null) return null;
  return { ...row, claim: row.locked_by };
}

export async function finishJob(
  db: Db,
  input: {
    jobId: string;
    claim: string;
    result?: Json | undefined;
    dispatched?: boolean;
    runUrl?: string;
  },
): Promise<boolean> {
  const { data, error } = await db.rpc("finish_job", {
    p_job_id: input.jobId,
    p_claim: input.claim,
    p_result: input.result ?? null,
    p_dispatched: input.dispatched ?? false,
    ...(input.runUrl === undefined ? {} : { p_run_url: input.runUrl }),
  });
  if (error !== null) throw unavailable("finish_job");
  return data;
}

export async function failJob(
  db: Db,
  input: { jobId: string; claim: string; error: string; dead?: boolean; runUrl?: string },
): Promise<boolean> {
  const { data, error } = await db.rpc("fail_job", {
    p_job_id: input.jobId,
    p_claim: input.claim,
    p_error: input.error,
    p_dead: input.dead ?? false,
    ...(input.runUrl === undefined ? {} : { p_run_url: input.runUrl }),
  });
  if (error !== null) throw unavailable("fail_job");
  return data;
}

/** A step's `retry_at` or a runner wait: back to `queued` at `runAfter` with no attempt used. */
export async function requeueJob(
  db: Db,
  input: {
    jobId: string;
    claim: string;
    runAfter: Date;
    kind: "requeued";
    result?: Json | undefined;
  },
): Promise<boolean> {
  const { data, error } = await db.rpc("requeue_job", {
    p_job_id: input.jobId,
    p_claim: input.claim,
    p_run_after: input.runAfter.toISOString(),
    p_kind: input.kind,
    p_result: input.result ?? null,
  });
  if (error !== null) throw unavailable("requeue_job");
  return data;
}
