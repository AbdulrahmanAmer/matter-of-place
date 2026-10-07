import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminKeys, invalidateAfterWrite } from "../query";
import {
  addNote,
  fetchOriginal,
  fetchSubmission,
  fetchSubmissions,
  fetchTimeline,
  startReview,
} from "./requests-api";

/** The filters of screen 3 that live in the address, beside the cursor. */
export const requestFilterNames = [
  "workflow_state",
  "view",
  "market",
  "package",
  "search",
] as const;

export type RequestFilterName = (typeof requestFilterNames)[number];

export function useSubmissions(query: Readonly<Record<string, string>>) {
  return useQuery({
    queryKey: adminKeys.submissions.list(query),
    queryFn: () => fetchSubmissions(query),
  });
}

export function useSubmission(id: string) {
  return useQuery({
    queryKey: adminKeys.submissions.detail(id),
    queryFn: () => fetchSubmission(id),
  });
}

export function useSubmissionTimeline(id: string) {
  return useQuery({
    queryKey: adminKeys.submissions.timeline(id),
    queryFn: () => fetchTimeline(id),
  });
}

/** Every request's timeline sits under the feature key, so one invalidation covers a whole selection. */
export function useStartReview() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: startReview,
    onSettled: () => invalidateAfterWrite(queryClient, adminKeys.submissions.all()),
  });
}

export function useAddNote(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (text: string) => addNote(id, text),
    onSettled: () =>
      invalidateAfterWrite(
        queryClient,
        adminKeys.submissions.all(),
        adminKeys.submissions.timeline(id),
      ),
  });
}

/** Asks for the address of one original; nothing is cached, the address lives ten minutes. */
export function useOriginal(id: string) {
  return useMutation({ mutationFn: (mediaId: string) => fetchOriginal(id, mediaId) });
}
