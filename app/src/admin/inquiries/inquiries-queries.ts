import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchJob } from "../jobs/jobs-api";
import { adminKeys, invalidateAfterWrite } from "../query";
import {
  assignInquiry,
  closeInquiry,
  fetchAssignees,
  fetchInquiries,
  fetchInquiry,
  forwardInquiry,
} from "./inquiries-api";

/** The filters of screen 11 that live in the address, beside the cursor. */
export const inquiryFilterNames = ["state"] as const;

const FINISHED = new Set(["done", "dead", "cancelled"]);

export function useInquiries(query: Readonly<Record<string, string>>) {
  return useQuery({
    queryKey: adminKeys.inquiries.list(query),
    queryFn: () => fetchInquiries(query),
  });
}

export function useInquiry(id: string) {
  return useQuery({
    queryKey: adminKeys.inquiries.detail(id),
    queryFn: () => fetchInquiry(id),
  });
}

export function useAssignees() {
  return useQuery({
    queryKey: [...adminKeys.inquiries.all(), "assignees"],
    queryFn: fetchAssignees,
  });
}

/** The forward job, read again every two seconds until it has finished, so the drawer shows how it ended. */
export function useForwardJob(id: string) {
  return useQuery({
    queryKey: adminKeys.jobs.detail(id),
    queryFn: () => fetchJob(id),
    refetchInterval: (query) => (FINISHED.has(query.state.data?.status ?? "") ? false : 2000),
  });
}

function useInquiryWrite<Variables extends { id: string }, Answer>(
  write: (variables: Variables) => Promise<Answer>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: write,
    onSettled: (_answer, _error, { id }) =>
      invalidateAfterWrite(
        queryClient,
        adminKeys.inquiries.all(),
        adminKeys.inquiries.timeline(id),
      ),
  });
}

export const useAssignInquiry = () =>
  useInquiryWrite(({ id, assignee }: { id: string; assignee: string }) =>
    assignInquiry(id, assignee),
  );
export const useForwardInquiry = () =>
  useInquiryWrite(({ id }: { id: string }) => forwardInquiry(id));
export const useCloseInquiry = () => useInquiryWrite(({ id }: { id: string }) => closeInquiry(id));
