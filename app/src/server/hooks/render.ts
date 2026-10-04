import { z } from "zod";
import type { Json } from "../../db/index.ts";
import { failJob, finishJob } from "../jobs/claim.ts";
import { getStep } from "../jobs/steps/index.ts";
import type { Reporter, RunnerEnv, StepContext } from "../jobs/types.ts";
import type { Db } from "../lib/db.ts";
import { env as serverEnv, sentryOptions } from "../lib/env.ts";
import { AppError, toErrorResponse } from "../lib/errors.ts";
import { verifyBody } from "../lib/hmac.ts";
import { logLine } from "../lib/log.ts";
import { captureException } from "../lib/sentry.ts";

const ROUTE = "/api/hooks/render/callback";
const MAX_AGE_SECONDS = 300;

// `result` is read from JSON.parse output, so any value it holds is JSON.
const json = z.custom<Json>(() => true);

const bodySchema = z.object({
  job_id: z.string().uuid(),
  claim: z.string().min(1),
  status: z.enum(["done", "failed"]),
  result: json.optional(),
  error: z.string().optional(),
  retryable: z.boolean().default(true),
  run_url: z.string().url(),
});
type CallbackBody = z.infer<typeof bodySchema>;

const JOB_COLUMNS = "id, type, status, locked_by, attempts, result, event_id";

function answer(body: Record<string, unknown>): Response {
  return Response.json(body, { headers: { "cache-control": "no-store" } });
}

function refused(code: "bad_request" | "forbidden", status: number, message: string): never {
  throw new AppError(code, status, message);
}

async function readBody(request: Request, secret: string, now: Date): Promise<CallbackBody> {
  const raw = await request.text();
  const timestamp = request.headers.get("x-mop-timestamp") ?? "";
  const signature = request.headers.get("x-mop-signature") ?? "";
  const age = Math.abs(now.getTime() / 1000 - Number(timestamp));
  if (!/^\d+$/.test(timestamp) || age > MAX_AGE_SECONDS) {
    refused("forbidden", 401, "The callback timestamp is missing or too old.");
  }
  if (!(await verifyBody(secret, timestamp, raw, signature))) {
    refused("forbidden", 401, "The callback signature did not match.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return refused("bad_request", 400, "The callback body is not JSON.");
  }
  const body = bodySchema.safeParse(parsed);
  if (!body.success) refused("bad_request", 400, "The callback body does not have its shape.");
  return body.data;
}

/** The step's `onResult`, then `finish_job` or `fail_job` under the callback's claim; false when the claim was lost. */
async function apply(db: Db, ctx: StepContext, body: CallbackBody): Promise<boolean> {
  const fenced = { jobId: body.job_id, claim: body.claim, runUrl: body.run_url };
  if (body.status === "failed") {
    return failJob(db, {
      ...fenced,
      error: body.error ?? "render_failed",
      dead: !body.retryable,
    });
  }
  const step = getStep(ctx.job.type);
  if (step?.onResult !== undefined) {
    try {
      await step.onResult(ctx, ctx.job, body.result ?? null);
    } catch (error) {
      await ctx.report(error, { fingerprint: ["render_on_result", ctx.job.type] });
      const message = error instanceof Error ? error.message : String(error);
      return failJob(db, { ...fenced, error: `on_result: ${message}` });
    }
  }
  return finishJob(db, { ...fenced, result: body.result });
}

/**
 * `POST /api/hooks/render/callback` (B8 Contract): the signed outcome of one render.yml run. The job read and one of
 * `finish_job` or `fail_job` are the hook's own calls (invariant 7); a job no longer `running` under the body's claim,
 * the callback already applied included, answers 200 `{ ignored: "stale_claim" }` with no change (JOB-02).
 */
export async function handleRenderCallback(
  db: Db,
  request: Request,
  env: RunnerEnv,
  requestId: string,
): Promise<Response> {
  try {
    const secret = serverEnv.RENDER_CALLBACK_SECRET;
    if (secret === undefined) {
      throw new AppError("unavailable", undefined, "The render callback is not configured.");
    }
    const now = new Date();
    const body = await readBody(request, secret, now);
    const { data: job, error } = await db
      .from("jobs")
      .select(JOB_COLUMNS)
      .eq("id", body.job_id)
      .maybeSingle();
    if (error !== null) throw new AppError("unavailable", undefined, "The job could not be read.");
    if (job === null) throw new AppError("not_found", undefined, "There is no such job.");
    if (job.status !== "running" || job.locked_by !== body.claim) {
      return answer({ ignored: "stale_claim" });
    }
    const report: Reporter = (cause, { fingerprint, level }) =>
      captureException(cause, {
        ...sentryOptions(),
        requestId,
        route: ROUTE,
        fingerprint,
        ...(level === undefined ? {} : { level }),
      });
    const ctx: StepContext = {
      db,
      env,
      log: logLine,
      now,
      signal: request.signal,
      report,
      job: {
        id: job.id,
        type: job.type,
        attempts: job.attempts,
        claim: body.claim,
        result: job.result,
        eventId: job.event_id,
      },
    };
    return (await apply(db, ctx, body))
      ? answer({ applied: body.status })
      : answer({ ignored: "stale_claim" });
  } catch (error) {
    if (error instanceof AppError) return toErrorResponse(error, requestId);
    throw error;
  }
}
