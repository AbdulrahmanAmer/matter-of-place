import { z } from "zod";
import { skipReasons, stepSchema } from "../../domain/automation";
import { adminFetch } from "../ui/admin-fetch";

// The browser side of screen 17. Components reach these through `automation-queries.ts`.

const fieldKinds = ["text", "number", "select", "multiselect", "boolean"] as const;

const fieldSchema = z.object({
  key: z.string(),
  label: z.string(),
  kind: z.enum(fieldKinds),
  required: z.boolean().optional(),
  options: z.array(z.object({ value: z.string(), label: z.string() })).optional(),
  default: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  hint: z.string().optional(),
});

/** One entry of the step catalog, as `GET /api/admin/automation/recipes` sends it (`step-specs.ts` without its Zod schema). */
const stepSpecSchema = z.object({
  type: z.string(),
  label: z.string(),
  description: z.string(),
  heavy: z.boolean(),
  local: z.boolean(),
  implemented: z.boolean(),
  fields: z.array(fieldSchema),
});

const recipeRowSchema = z.object({
  id: z.string(),
  trigger: z.string(),
  name: z.string(),
  enabled: z.boolean(),
  steps: z.array(stepSchema),
  version: z.number(),
});

const recipeListSchema = z.object({
  items: z.array(recipeRowSchema),
  steps: z.array(stepSpecSchema),
});

const dryRunSchema = z.object({
  trigger: z.string(),
  recipe_enabled: z.boolean(),
  planned: z.array(
    z.object({
      step_id: z.string(),
      type: z.string(),
      heavy: z.boolean(),
      run_local: z.boolean(),
      status: z.enum(["queued", "waiting_approval"]),
    }),
  ),
  skipped: z.array(
    z.object({ step_id: z.string(), type: z.string(), reason: z.enum(skipReasons) }),
  ),
  warnings: z.array(
    z.object({ code: z.string(), step_id: z.string().nullable(), message: z.string() }),
  ),
});

export type StepField = z.infer<typeof fieldSchema>;
export type StepSpecView = z.infer<typeof stepSpecSchema>;
export type RecipeRow = z.infer<typeof recipeRowSchema>;
export type { Step } from "../../domain/automation";

/** What a save sends: the three keys the server's `recipePutInput` accepts beside the trigger in the path. */
export interface RecipePatch {
  name: string;
  enabled: boolean;
  steps: readonly z.infer<typeof stepSchema>[];
}

export function fetchRecipes() {
  return adminFetch("/api/admin/automation/recipes", recipeListSchema);
}

export function putRecipe(trigger: string, patch: RecipePatch) {
  return adminFetch(
    `/api/admin/automation/recipes/${encodeURIComponent(trigger)}`,
    recipeRowSchema,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    },
  );
}

/** What the planner would do with the saved recipe of `trigger`; `entityId` builds the sample from that row. */
export function runDryRun(trigger: string, entityId: string | undefined) {
  return adminFetch("/api/admin/automation/dry-run", dryRunSchema, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(entityId === undefined ? { trigger } : { trigger, entity_id: entityId }),
  });
}
