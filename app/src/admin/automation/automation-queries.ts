import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminKeys, invalidateAfterWrite } from "../query";
import type { EmailTemplateKey } from "../../domain/email";
import type { FeatureFlag } from "../../domain/flags";
import {
  fetchChannelSettings,
  fetchFlags,
  fetchPreview,
  fetchReasons,
  fetchRecipes,
  fetchRevisions,
  fetchScheduleSettings,
  fetchTemplates,
  postReason,
  postRestore,
  postSendTest,
  putChannelSettings,
  putFlags,
  putReason,
  putReasonOrder,
  putRecipe,
  putScheduleSettings,
  putTemplate,
  runDryRun,
  type ChannelPatch,
  type ChannelRow,
  type ReasonDraft,
  type ReasonPatch,
  type RecipePatch,
  type SchedulePatch,
  type TemplatePatch,
} from "./automation-api";

export type {
  ChannelPatch,
  ChannelRow,
  ReasonDraft,
  ReasonPatch,
  ReasonRow,
  RecipePatch,
  RecipeRow,
  RevisionRow,
  SchedulePatch,
  ScheduleRow,
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

/** The decline reasons in the order of screen 19. */
export function useReasons() {
  return useQuery({
    queryKey: adminKeys.automation.reasons(),
    queryFn: fetchReasons,
  });
}

/** A new reason, or an edit of one; the next decline email reads it. */
export function useSaveReason() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string | null; draft: ReasonDraft; patch: ReasonPatch }) =>
      input.id === null ? postReason(input.draft) : putReason(input.id, input.patch),
    onSettled: () => invalidateAfterWrite(queryClient, adminKeys.automation.all()),
  });
}

/** One request with every id in the order wanted. */
export function useReorderReasons() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ids: readonly string[]) => putReasonOrder(ids),
    onSettled: () => invalidateAfterWrite(queryClient, adminKeys.automation.all()),
  });
}

/** One row per channel; the rows carry no `credentials_ref`. */
export function useChannelSettings() {
  return useQuery({
    queryKey: adminKeys.automation.channels(),
    queryFn: fetchChannelSettings,
  });
}

export function useSaveChannel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ channel, patch }: { channel: ChannelRow["channel"]; patch: ChannelPatch }) =>
      putChannelSettings(channel, patch),
    onSettled: () => invalidateAfterWrite(queryClient, adminKeys.automation.all()),
  });
}

/** The eight clocks, each with the next run the scheduler computes. */
export function useScheduleSettings() {
  return useQuery({
    queryKey: adminKeys.automation.schedules(),
    queryFn: fetchScheduleSettings,
  });
}

export function useSaveSchedule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ key, patch }: { key: string; patch: SchedulePatch }) =>
      putScheduleSettings(key, patch),
    onSettled: () => invalidateAfterWrite(queryClient, adminKeys.automation.all()),
  });
}

/** The feature flags, read by every role; screens 20 and 24 both show them. */
export function useFlags() {
  return useQuery({
    queryKey: adminKeys.settings.list({ flags: true }),
    queryFn: fetchFlags,
  });
}

/** A flag changes the next public read within one state interval; settings and automation both refetch. */
export function useSaveFlag() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ flag, value }: { flag: FeatureFlag; value: boolean }) =>
      putFlags({ [flag]: value }),
    onSettled: async () => {
      await invalidateAfterWrite(queryClient, adminKeys.settings.all());
      await queryClient.invalidateQueries({ queryKey: adminKeys.automation.all() });
    },
  });
}

/** One page of revisions, newest first; the address holds the table filter and the cursor. */
export function useRevisions(query: Readonly<Record<string, string>>) {
  return useQuery({
    queryKey: adminKeys.automation.revisions(query),
    queryFn: () => fetchRevisions(query),
  });
}

/** A restore writes one new revision and changes a row of one of the five tables; the whole automation feature, revisions included, refetches. */
export function useRestoreRevision() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => postRestore(id),
    onSettled: () => invalidateAfterWrite(queryClient, adminKeys.automation.all()),
  });
}
