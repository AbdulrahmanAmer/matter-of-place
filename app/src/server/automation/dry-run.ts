import { skipReasonLabels } from "../../domain/automation.ts";
import { getStep } from "../jobs/steps/index.ts";
import type { JsonObject } from "../jobs/types.ts";
import type { Db } from "../lib/db.ts";
import { AppError } from "../lib/errors.ts";
import { payloadIsValid, readRecipe } from "./fanout.ts";
import { planEvent, type Plan, type PlannedJob } from "./plan.ts";
import { samplePayloadFor } from "./sample-payloads.ts";

// What the planner would do with one event, with nothing written (B8b invariant 3). It calls `planEvent`, the same
// function real fan-out calls, so the two cannot drift. It makes no RPC and takes no lock: only reads.

const DRY_RUN_EVENT = "dry-run";

export interface DryRunInput {
  trigger: string;
  /** The row the event is about; the payload is built from it. */
  entity_id?: string;
  /** A payload to plan as given, instead of one built from a row. */
  payload?: JsonObject;
}

type WarningCode =
  | "recipe_disabled"
  | "payload_invalid"
  | "step_not_implemented"
  | "template_missing"
  | "template_disabled";

interface DryRunWarning {
  code: WarningCode;
  step_id: string | null;
  message: string;
}

type PlannedStep = Pick<
  PlannedJob,
  "step_id" | "type" | "heavy" | "run_local" | "status" | "idempotency_key" | "max_attempts"
> & { params: PlannedJob["payload"]["params"] };

export interface DryRunResult extends Pick<Plan, "trigger" | "recipe_enabled" | "skipped"> {
  planned: PlannedStep[];
  warnings: DryRunWarning[];
}

/** The email template a planned step will send, when its parameters name one. */
function templateOf(job: PlannedJob): string | undefined {
  const { params } = job.payload;
  if (typeof params !== "object" || params === null || Array.isArray(params)) return undefined;
  const key = params["template"];
  return typeof key === "string" ? key : undefined;
}

async function templateWarnings(db: Db, planned: readonly PlannedJob[]): Promise<DryRunWarning[]> {
  const named = planned.flatMap((job) => {
    const key = templateOf(job);
    return key === undefined ? [] : [{ step_id: job.step_id, key }];
  });
  if (named.length === 0) return [];
  const { data, error } = await db
    .from("email_templates")
    .select("key, enabled")
    .in(
      "key",
      named.map(({ key }) => key),
    );
  if (error !== null) {
    throw new AppError("unavailable", undefined, "The email templates could not be read.");
  }
  const enabled = new Map(data.map((row) => [row.key, row.enabled]));
  return named.flatMap(({ step_id, key }): DryRunWarning[] => {
    const state = enabled.get(key);
    if (state === undefined) {
      return [
        { code: "template_missing", step_id, message: `The email template ${key} does not exist.` },
      ];
    }
    return state
      ? []
      : [{ code: "template_disabled", step_id, message: `The email template ${key} is off.` }];
  });
}

export async function dryRun(db: Db, input: DryRunInput): Promise<DryRunResult> {
  const recipe = await readRecipe(db, input.trigger);
  const payload =
    input.payload ?? (await samplePayloadFor(db, input.trigger, input.entity_id, new Date()));
  const plan = planEvent(recipe, { id: DRY_RUN_EVENT, payload }, { registry: getStep });

  const warnings: DryRunWarning[] = [];
  if (!recipe.enabled) {
    warnings.push({
      code: "recipe_disabled",
      step_id: null,
      message: skipReasonLabels.recipe_disabled,
    });
  }
  if (!payloadIsValid(input.trigger, payload)) {
    warnings.push({
      code: "payload_invalid",
      step_id: null,
      message: "The payload does not match what this event carries.",
    });
  }
  for (const step of plan.skipped) {
    if (step.reason === "not_implemented") {
      warnings.push({
        code: "step_not_implemented",
        step_id: step.step_id,
        message: skipReasonLabels.not_implemented,
      });
    }
  }
  warnings.push(...(await templateWarnings(db, plan.planned)));

  return {
    trigger: plan.trigger,
    recipe_enabled: plan.recipe_enabled,
    planned: plan.planned.map((job) => ({
      step_id: job.step_id,
      type: job.type,
      heavy: job.heavy,
      run_local: job.run_local,
      status: job.status,
      params: job.payload.params,
      idempotency_key: job.idempotency_key,
      max_attempts: job.max_attempts,
    })),
    skipped: plan.skipped,
    warnings,
  };
}
