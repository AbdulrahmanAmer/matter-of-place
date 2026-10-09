import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminKeys, invalidateAfterWrite } from "../query";
import {
  addNote,
  decide,
  fetchDeclineReasons,
  fetchOriginal,
  fetchSubmission,
  fetchSubmissions,
  fetchTimeline,
  markAssetsReceived,
  previewEmail,
  startReview,
  withdraw,
  type Decision,
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

/** The reasons the decline dialog offers, read once it opens. */
export function useDeclineReasons(open: boolean) {
  return useQuery({
    queryKey: [...adminKeys.submissions.all(), "decline-reasons"],
    queryFn: fetchDeclineReasons,
    enabled: open,
  });
}

/** One decision on this request; it settles the request lists, its detail and its history. */
export function useDecision(id: string, decision: Decision) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: Readonly<Record<string, string>>) => decide(id, decision, body),
    onSettled: () =>
      invalidateAfterWrite(
        queryClient,
        adminKeys.submissions.all(),
        adminKeys.submissions.timeline(id),
      ),
  });
}

export function useAssetsReceived(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => markAssetsReceived(id),
    onSettled: () =>
      invalidateAfterWrite(
        queryClient,
        adminKeys.submissions.all(),
        adminKeys.submissions.timeline(id),
      ),
  });
}

/** Withdraws this request; the invoice it voids moves the invoice list too. */
export function useWithdraw(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (reason: string) => withdraw(id, reason),
    onSettled: () =>
      Promise.all([
        invalidateAfterWrite(
          queryClient,
          adminKeys.submissions.all(),
          adminKeys.submissions.timeline(id),
        ),
        queryClient.invalidateQueries({ queryKey: adminKeys.payments.all() }),
      ]),
  });
}

/** Renders the letter a decision would send; asked for by a button, never cached. */
export function useEmailPreview(id: string) {
  return useMutation({
    mutationFn: (body: Parameters<typeof previewEmail>[1]) => previewEmail(id, body),
  });
}
