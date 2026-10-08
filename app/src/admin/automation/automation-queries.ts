import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminKeys, invalidateAfterWrite } from "../query";
import type { EmailTemplateKey } from "../../domain/email";
import {
  fetchPreview,
  fetchRecipes,
  fetchTemplates,
  postSendTest,
  putRecipe,
  putTemplate,
  runDryRun,
  type RecipePatch,
  type TemplatePatch,
} from "./automation-api";

export type {
  RecipePatch,
  RecipeRow,
  Step,
  StepField,
  StepSpecView,
  TemplatePatch,
  TemplateRow,
} from "./automation-api";

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

/** The email templates, one row per key of B5's closed set. */
export function useTemplates() {
  return useQuery({
    queryKey: adminKeys.automation.templates(),
    queryFn: fetchTemplates,
  });
}

/** A saved template is what the next send uses; the whole automation feature and the dashboard counts refetch. */
export function useSaveTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ key, patch }: { key: EmailTemplateKey; patch: TemplatePatch }) =>
      putTemplate(key, patch),
    onSettled: () => invalidateAfterWrite(queryClient, adminKeys.automation.all()),
  });
}

/**
 * The saved template drawn with `variables` on top of the sample values. A `POST` that writes nothing, read as a query
 * so the saved `version` and the variables are its key: a save or a changed value draws it again, and nothing else does.
 */
export function useTemplatePreview(
  key: EmailTemplateKey,
  version: number,
  variables: Readonly<Record<string, string>>,
) {
  return useQuery({
    queryKey: adminKeys.automation.templates({ preview: key, version, variables }),
    queryFn: () => fetchPreview(key, variables),
  });
}

/** Queues a job that mails the admin; it changes no row an admin screen shows, so no query refetches. */
export function useSendTest() {
  return useMutation({ mutationFn: (key: EmailTemplateKey) => postSendTest(key) });
}
