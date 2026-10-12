// Gap audit item 34: every flow in the database plans cleanly. Each recipe goes through `dryRun`, the function the
// Flows screen's "Try it safely" calls, with its sample payload (or an empty one when the event needs a real record):
// no step may carry parameters its step does not accept, and no step may name an email template that does not exist.
// It only reads, so it runs on the one database as well as on CI's stack.
import "../fixtures/worker-env";
import { describe, expect, it } from "vitest";
import { serviceClient } from "../fixtures/service";
import { dryRun, type DryRunResult } from "../../src/server/automation/dry-run";
import { AppError } from "../../src/server/lib/errors";

async function planned(trigger: string): Promise<DryRunResult> {
  const db = serviceClient();
  try {
    return await dryRun(db, { trigger });
  } catch (failure) {
    if (failure instanceof AppError && failure.code === "validation") {
      return dryRun(db, { trigger, payload: {} });
    }
    throw failure;
  }
}

describe("the seeded flows (gap item 34)", () => {
  it("plan with no step whose parameters do not parse and no email template that does not exist", async () => {
    const { data, error } = await serviceClient().from("automation_recipes").select("trigger");
    if (error !== null) throw new Error(error.message);
    const problems: string[] = [];
    for (const { trigger } of data) {
      const result = await planned(trigger);
      for (const step of result.skipped) {
        if (step.reason === "invalid_params")
          problems.push(`${trigger}: ${step.type} invalid_params`);
      }
      for (const warning of result.warnings) {
        if (warning.code === "template_missing") problems.push(`${trigger}: ${warning.message}`);
      }
    }
    expect({ flows: data.length >= 10, problems }).toEqual({ flows: true, problems: [] });
  });
});
