import { RateLimited } from "../../channels/resend.ts";
import { runHygiene } from "../../newsletter/hygiene.ts";
import type { StepContext, StepResult, SystemJobDefinition } from "../types.ts";
import { NonRetryableError } from "../types.ts";

// System job `newsletter_hygiene` (B11 invariant 10): enqueued once a day by `runDueSchedules` from the
// `schedule_settings` row of the same name, so screen 20 can pause it. A 429 from Resend waits for its `retryAt`.

async function run(ctx: StepContext): Promise<StepResult> {
  const sealKey = ctx.env["CONFIRM_TOKEN_SECRET"];
  if (sealKey === undefined || sealKey === "")
    throw new NonRetryableError("confirm_secret_missing");
  try {
    return { status: "done", result: await runHygiene(ctx.db, sealKey) };
  } catch (error) {
    if (error instanceof RateLimited) {
      return { status: "retry_at", at: error.retryAt, reason: error.message };
    }
    throw error;
  }
}

export const newsletterHygiene: SystemJobDefinition = {
  type: "newsletter_hygiene",
  sideEffect: "sql_guard",
  maxAttempts: 12,
  run: (ctx) => run(ctx),
};
