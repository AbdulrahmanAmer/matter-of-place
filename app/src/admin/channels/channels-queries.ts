import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ChannelIdsKey } from "../../domain/channels";
import { adminKeys, invalidateAfterWrite } from "../query";
import {
  cancelPost,
  fetchHealth,
  fetchPosts,
  markWithdrawn,
  refreshMetrics,
  retryPost,
  saveIds,
} from "./channels-api";

/** The filters of screen 12 that live in the address, beside the page: `post` is the link of a failure mail. */
export const channelFilterNames = ["channel", "status", "post"] as const;

export type ChannelFilterName = (typeof channelFilterNames)[number];

/** The posts of one page of the table; `post` narrows to the one row a failure mail links to. */
export function usePosts(
  values: Readonly<Partial<Record<ChannelFilterName, string>>>,
  page: number,
) {
  const { post, ...filters } = values;
  const query: Record<string, string> =
    post === undefined ? { ...filters, page: String(page) } : { post_id: post };
  return useQuery({
    queryKey: adminKeys.channels.list({ posts: query }),
    queryFn: () => fetchPosts(query),
  });
}

/** The posts still to delete by hand after a takedown, oldest first (invariant 10). */
export function useWithdrawList() {
  return useQuery({
    queryKey: adminKeys.channels.list({ withdraw: true }),
    queryFn: () => fetchPosts({ withdraw: "true" }),
  });
}

export function useChannelHealth() {
  return useQuery({
    queryKey: adminKeys.channels.list({ health: true }),
    queryFn: fetchHealth,
  });
}

/** Every write of screen 12 refreshes the whole feature: the table, the withdraw list and the cards. */
function usePostAction<Variables>(action: (variables: Variables) => Promise<unknown>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: action,
    onSettled: () => invalidateAfterWrite(queryClient, adminKeys.channels.all()),
  });
}

export const useRetry = () =>
  usePostAction(({ id, force }: { id: string; force: boolean }) => retryPost(id, force));
export const useCancel = () => usePostAction(cancelPost);
export const useRefreshMetrics = () => usePostAction(refreshMetrics);
export const useMarkWithdrawn = () => usePostAction(markWithdrawn);

export function useSaveIds(key: ChannelIdsKey) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (fields: Readonly<Record<string, unknown>>) => saveIds(key, fields),
    onSettled: () => invalidateAfterWrite(queryClient, adminKeys.channels.all()),
  });
}
