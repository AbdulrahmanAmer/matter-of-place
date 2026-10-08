import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminKeys, invalidateAfterWrite } from "../query";
import { fetchRecipes, putRecipe, runDryRun, type RecipePatch } from "./automation-api";

export type { RecipePatch, RecipeRow, Step, StepField, StepSpecView } from "./automation-api";

/** The recipes, one per event type, and the step catalog the editor offers. */
export function useRecipes() {
  return useQuery({
    queryKey: adminKeys.automation.recipes(),
    queryFn: fetchRecipes,
  });
}

/** A saved recipe applies to the next event; the whole automation feature and the dashboard counts refetch. */
export function useSaveRecipe() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ trigger, patch }: { trigger: string; patch: RecipePatch }) =>
      putRecipe(trigger, patch),
    onSettled: () => invalidateAfterWrite(queryClient, adminKeys.automation.all()),
  });
}

/** A `POST` that writes nothing (invariant 3): it plans the saved recipe against a sample event, so no query refetches. */
export function useDryRun() {
  return useMutation({
    mutationFn: ({ trigger, entityId }: { trigger: string; entityId: string | undefined }) =>
      runDryRun(trigger, entityId),
  });
}
