import { z } from "zod";
import type { StepDefinition } from "../types.ts";
import { NonRetryableError } from "../types.ts";
import { dispatchHeavy } from "./heavy.ts";

// The two steps `scripts/job-selftest.ts` enqueues to prove the job system end to end (B8 step 8). `fail`
// drives the failure proofs; the heavy step's `fail` travels to the render job in `payload.params`.

const paramsSchema = z.object({ fail: z.enum(["throw", "nonretryable"]).optional() }).strict();
type SelftestParams = z.infer<typeof paramsSchema>;

const selftestLight: StepDefinition<SelftestParams> = {
  type: "test.selftest_light",
  heavy: false,
  paramsSchema,
  run(ctx, params) {
    if (params.fail === "throw") throw new Error("selftest_throw");
    if (params.fail === "nonretryable") throw new NonRetryableError("selftest_nonretryable");
    return Promise.resolve({ status: "done", result: { ran_at: ctx.now.toISOString() } });
  },
};

const selftestHeavy: StepDefinition<SelftestParams> = {
  type: "test.selftest_heavy",
  heavy: true,
  paramsSchema,
  run(ctx, params, data) {
    return dispatchHeavy(ctx, { params, data });
  },
};

export const selftestSteps: readonly StepDefinition[] = [selftestLight, selftestHeavy];
