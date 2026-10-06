import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminKeys, invalidateAfterWrite } from "../query";
import { fetchSubmissions, startReview } from "./requests-api";

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

/** Every request's timeline sits under the feature key, so one invalidation covers a whole selection. */
export function useStartReview() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: startReview,
    onSettled: () => invalidateAfterWrite(queryClient, adminKeys.submissions.all()),
  });
}
