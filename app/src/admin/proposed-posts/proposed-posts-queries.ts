import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminKeys, invalidateAfterWrite } from "../query";
import {
  approveProposedPost,
  fetchProposedPost,
  fetchProposedPosts,
  rejectProposedPost,
  rerenderProposedPost,
} from "./proposed-posts-api";

/** The filter of the screen that lives in the address (the page's cursor lives there too, `use-url-filters.ts`). */
export const proposedFilterNames = ["status"] as const;

export function useProposedPosts(query: Readonly<Record<string, string>>) {
  return useQuery({
    queryKey: adminKeys.proposedPosts.list(query),
    queryFn: () => fetchProposedPosts(query),
  });
}

/** The revisions of one post, read only once its history is opened. */
export function useProposedPost(id: string, enabled: boolean) {
  return useQuery({
    queryKey: adminKeys.proposedPosts.detail(id),
    queryFn: () => fetchProposedPost(id),
    enabled,
  });
}

function useDecision<Variables, Answer>(write: (variables: Variables) => Promise<Answer>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: write,
    onSettled: () => invalidateAfterWrite(queryClient, adminKeys.proposedPosts.all()),
  });
}

export function useApprovePost() {
  return useDecision(({ id, revision }: { id: string; revision: number }) =>
    approveProposedPost(id, revision),
  );
}

export function useRejectPost() {
  return useDecision(({ id, note }: { id: string; note: string }) => rejectProposedPost(id, note));
}

export function useRerenderPost() {
  return useDecision(({ id, note }: { id: string; note: string }) =>
    rerenderProposedPost(id, note),
  );
}
