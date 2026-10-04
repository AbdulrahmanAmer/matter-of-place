import type { StepContext, StepResult } from "./types.ts";
import { NonRetryableError } from "./types.ts";

// The GitHub adapter (R32): one `workflow_dispatch` of render.yml per heavy job (JOB-01). The token needs
// only Actions write, so it cannot push to main (SEC-02).

const NOT_CONFIGURED_WAIT_MS = 60 * 60 * 1000;

/** Answers no retry can fix: the job goes `dead` with `dispatch_<status>` and shows on screen 16 (R34). */
export const dispatchRefusals: Readonly<Record<number, string>> = {
  401: "dispatch_401",
  403: "dispatch_403",
  404: "dispatch_404",
  422: "dispatch_422",
};

/**
 * Sends `client_payload` as the one input `job`. A 204 is `dispatched`; with no token or repository the job
 * waits an hour and uses no attempt; a refusal throws `NonRetryableError`; any other answer or a network
 * error throws, which is the normal backoff (invariant 4).
 */
export async function dispatchRender(
  ctx: StepContext,
  clientPayload: Record<string, unknown>,
): Promise<StepResult> {
  const token = ctx.env["GITHUB_DISPATCH_TOKEN"];
  const repo = ctx.env["GITHUB_REPO"];
  if (!token || !repo) {
    return {
      status: "retry_at",
      at: new Date(ctx.now.getTime() + NOT_CONFIGURED_WAIT_MS),
      reason: "dispatch_not_configured",
    };
  }
  const response = await fetch(
    `https://api.github.com/repos/${repo}/actions/workflows/render.yml/dispatches`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ref: "main", inputs: { job: JSON.stringify(clientPayload) } }),
      signal: ctx.signal,
    },
  );
  if (response.status === 204) return { status: "dispatched" };
  const refusal = dispatchRefusals[response.status];
  if (refusal !== undefined) throw new NonRetryableError(refusal);
  throw new Error(`dispatch_${String(response.status)}`);
}
