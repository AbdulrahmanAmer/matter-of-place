import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { IssueUpdateInput } from "../../domain/admin-newsletter";
import { adminKeys, invalidateAfterWrite } from "../query";
import {
  approveIssue,
  buildIssue,
  fetchIssue,
  fetchIssues,
  fetchPreview,
  fetchInterest,
  fetchSubscribers,
  saveIssue,
  sendTestIssue,
  unapproveIssue,
} from "./newsletter-api";

export function useIssues() {
  return useQuery({ queryKey: adminKeys.newsletter.list({}), queryFn: fetchIssues });
}

export function useIssue(id: string) {
  return useQuery({ queryKey: adminKeys.newsletter.detail(id), queryFn: () => fetchIssue(id) });
}

/** The saved issue as a subscriber will get it; a write of the issue refreshes it with the rest of the feature. */
export function useIssuePreview(id: string, viewport: "desktop" | "phone") {
  return useQuery({
    queryKey: [...adminKeys.newsletter.detail(id), "preview", viewport],
    queryFn: () => fetchPreview(id, viewport),
  });
}

/** The Interest screen: every signup, read again each minute so a new one shows without a reload. */
export function useInterest() {
  return useQuery({
    queryKey: [...adminKeys.newsletter.all(), "interest"],
    queryFn: fetchInterest,
    refetchInterval: 60_000,
  });
}

/** `enabled` is false while the other tab is open: the counts read every subscriber. */
export function useSubscriberCounts(enabled: boolean) {
  return useQuery({
    queryKey: [...adminKeys.newsletter.all(), "subscribers"],
    queryFn: fetchSubscribers,
    enabled,
  });
}

export function useBuildIssue() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: buildIssue,
    onSettled: () => invalidateAfterWrite(queryClient, adminKeys.newsletter.all()),
  });
}

export function useSaveIssue(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (draft: Omit<IssueUpdateInput, "id">) => saveIssue(id, draft),
    onSettled: () =>
      invalidateAfterWrite(
        queryClient,
        adminKeys.newsletter.all(),
        adminKeys.newsletter.timeline(id),
      ),
  });
}

export function useApproveIssue(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sendAt?: string) => approveIssue(id, sendAt),
    onSettled: () =>
      invalidateAfterWrite(
        queryClient,
        adminKeys.newsletter.all(),
        adminKeys.newsletter.timeline(id),
      ),
  });
}

export function useUnapproveIssue(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => unapproveIssue(id),
    onSettled: () =>
      invalidateAfterWrite(
        queryClient,
        adminKeys.newsletter.all(),
        adminKeys.newsletter.timeline(id),
      ),
  });
}

export function useSendTest(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => sendTestIssue(id),
    onSettled: () => invalidateAfterWrite(queryClient, adminKeys.newsletter.all()),
  });
}
