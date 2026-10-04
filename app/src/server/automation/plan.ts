import type { Conditions, Recipe, SkipReason, Step } from "../../domain/automation.ts";
import type { JobPayload, JsonObject } from "../jobs/types.ts";
import { getSpec, isImplemented, type StepRegistry } from "./catalog.ts";
import { defaultMaxAttempts } from "./step-specs.ts";

// The one function that turns an event into jobs. Real fan-out and dry-run both call it, so they cannot drift (B8b
// invariant 3). It is pure: it reads no clock and no table, and the caller passes the step registry.

export type { SkipReason };

export interface PlanRecipe extends Pick<Recipe, "enabled"> {
  id: string;
  trigger: string;
  steps: readonly Step[];
}

export interface PlanEvent {
  id: string;
  payload: JsonObject;
}

export interface PlanContext {
  registry: StepRegistry;
}

/** One `jobs` row to insert, in the keys `fanout_insert_jobs` reads. */
export interface PlannedJob {
  recipe_id: string;
  step_id: string;
  type: string;
  heavy: boolean;
  /** The laptop runner's job (ruling H34 (2)): queued with no pgmq message. */
  run_local: boolean;
  status: "queued" | "waiting_approval";
  payload: JobPayload;
  idempotency_key: string;
  max_attempts: number;
}

interface SkippedStep {
  step_id: string;
  type: string;
  reason: SkipReason;
}

export interface Plan {
  trigger: string;
  recipe_enabled: boolean;
  planned: PlannedJob[];
  skipped: SkippedStep[];
}

function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value))
    return value.filter((entry): entry is string => typeof entry === "string");
  return [];
}

/** `tiers` against `payload.tier`, `markets` against `payload.market` or `payload.markets`, `kinds` against `payload.kind`; an absent payload field never matches. */
export function matchesConditions(conditions: Conditions, payload: JsonObject): boolean {
  const named = (accepted: readonly string[] | undefined, found: string[]): boolean =>
    accepted === undefined || found.some((value) => accepted.includes(value));
  return (
    named(conditions.tiers, strings(payload["tier"])) &&
    named(conditions.markets, [...strings(payload["market"]), ...strings(payload["markets"])]) &&
    named(conditions.kinds, strings(payload["kind"]))
  );
}

/** The skip reasons of a step in a fixed order; the first that applies is reported. */
export function planEvent(recipe: PlanRecipe, event: PlanEvent, ctx: PlanContext): Plan {
  const planned: PlannedJob[] = [];
  const skipped: SkippedStep[] = [];
  const skip = (step: Step, reason: SkipReason): void => {
    skipped.push({ step_id: step.id, type: step.step_type, reason });
  };
  for (const step of recipe.steps) {
    if (!recipe.enabled) {
      skip(step, "recipe_disabled");
      continue;
    }
    if (!step.enabled) {
      skip(step, "step_disabled");
      continue;
    }
    if (!matchesConditions(step.conditions, event.payload)) {
      skip(step, "condition");
      continue;
    }
    const spec = getSpec(step.step_type);
    if (spec === undefined || !isImplemented(step.step_type, ctx.registry)) {
      skip(step, "not_implemented");
      continue;
    }
    const params = spec.paramsSchema.safeParse(step.params);
    if (!params.success) {
      skip(step, "invalid_params");
      continue;
    }
    planned.push({
      recipe_id: recipe.id,
      step_id: step.id,
      type: spec.type,
      heavy: spec.heavy,
      run_local: spec.local ?? false,
      status: step.requires_approval ? "waiting_approval" : "queued",
      payload: { params: params.data, data: event.payload },
      idempotency_key: `${event.id}:${step.id}`,
      max_attempts: spec.maxAttempts ?? defaultMaxAttempts,
    });
  }
  return { trigger: recipe.trigger, recipe_enabled: recipe.enabled, planned, skipped };
}
