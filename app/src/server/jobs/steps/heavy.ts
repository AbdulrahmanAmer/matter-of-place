import { dispatchRender } from "../dispatch.ts";
import type { JobPayload, JsonObject, StepContext, StepResult } from "../types.ts";
import { NonRetryableError } from "../types.ts";

// The limit of one workflow_dispatch input (UNPROVEN exact value until B8 step 7 measures it).
const MAX_CLIENT_PAYLOAD_CHARS = 65_535;

/**
 * The run of every heavy step: one render.yml dispatch whose input carries the job id, its claim, the payload
 * envelope with `extra` merged into `data`, the runner's `MOP_ENV` and the callback address. On a 204 the
 * job stays `running` and `extra` is stored in `jobs.result`, where `onResult` reads it.
 */
export async function dispatchHeavy(
  ctx: StepContext,
  job: JobPayload,
  extra?: JsonObject,
): Promise<StepResult> {
  const clientPayload = {
    job_id: ctx.job.id,
    claim: ctx.job.claim,
    type: ctx.job.type,
    payload: { params: job.params, data: { ...job.data, ...extra } },
    env: ctx.env["MOP_ENV"],
    callback_url: ctx.env["RENDER_CALLBACK_URL"],
  };
  if (JSON.stringify(clientPayload).length > MAX_CLIENT_PAYLOAD_CHARS) {
    throw new NonRetryableError("payload_too_large");
  }
  const outcome = await dispatchRender(ctx, clientPayload);
  return outcome.status === "dispatched" ? { status: "dispatched", result: extra } : outcome;
}
