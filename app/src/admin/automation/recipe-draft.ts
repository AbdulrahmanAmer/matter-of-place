import { recipeSchema } from "../../domain/automation";
import type { RecipeRow, Step, StepField, StepSpecView } from "./automation-queries";

// The recipe as the person is editing it, and the checks that can be made before the server is asked. The server
// stays the check (it parses every step's params with the real schema); these catch what the form already knows.

export interface Draft {
  name: string;
  enabled: boolean;
  steps: Step[];
}

/** The most steps a recipe holds; the same bound as `recipeSchema`. */
export const maxSteps = 20;

export function draftOf(recipe: Pick<RecipeRow, "name" | "enabled" | "steps">): Draft {
  return { name: recipe.name, enabled: recipe.enabled, steps: [...recipe.steps] };
}

export function sameDraft(a: Draft, b: Draft): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** A step id is the type, then `_2`, `_3` and so on when the recipe already uses it. */
export function newStep(spec: StepSpecView, taken: readonly Step[]): Step {
  const used = new Set(taken.map((step) => step.id));
  let id = spec.type;
  for (let n = 2; used.has(id); n += 1) id = `${spec.type}_${String(n)}`;
  return {
    id,
    step_type: spec.type,
    params: {},
    enabled: true,
    requires_approval: false,
    conditions: {},
  };
}

function isBlank(value: unknown): boolean {
  return value === undefined || value === "" || (Array.isArray(value) && value.length === 0);
}

/** The message under one field, or undefined when it is fine. */
function fieldError(field: StepField, value: unknown): string | undefined {
  if (isBlank(value)) return field.required === true ? "Required" : undefined;
  if (field.kind !== "number") return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) return "Enter a number";
  if (field.min !== undefined && value < field.min) return `At least ${String(field.min)}`;
  if (field.max !== undefined && value > field.max) return `At most ${String(field.max)}`;
  return undefined;
}

export interface DraftErrors {
  name?: string;
  steps?: string;
  /** Per step index, per params key. */
  params: Record<number, Record<string, string>>;
}

/** Everything the form can tell before saving; `ok` is true when nothing is wrong. */
export function checkDraft(
  draft: Draft,
  specs: readonly StepSpecView[],
): DraftErrors & { ok: boolean } {
  const errors: DraftErrors = { params: {} };
  const parsed = recipeSchema.safeParse(draft);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      if (issue.path[0] === "name")
        errors.name ??= "Give the recipe a name of up to 120 characters";
      if (issue.path[0] === "steps" && issue.path.length === 1) errors.steps ??= issue.message;
    }
  }
  draft.steps.forEach((step, index) => {
    const spec = specs.find((candidate) => candidate.type === step.step_type);
    for (const field of spec?.fields ?? []) {
      const message = fieldError(field, step.params[field.key]);
      if (message !== undefined) (errors.params[index] ??= {})[field.key] = message;
    }
  });
  if (!parsed.success && errors.name === undefined && errors.steps === undefined) {
    errors.steps = parsed.error.issues[0]?.message ?? "The recipe is not valid";
  }
  const ok =
    errors.name === undefined &&
    errors.steps === undefined &&
    Object.keys(errors.params).length === 0;
  return { ...errors, ok };
}
