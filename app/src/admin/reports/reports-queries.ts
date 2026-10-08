import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminKeys, invalidateAfterWrite } from "../query";
import { emailReport, fetchReport, fetchReports } from "./reports-api";

/** The filter of screen 22 that lives in the address, beside the page. */
export const reportFilterNames = ["campaign"] as const;

export function useReports(campaign: string | undefined, page: number) {
  const query: Record<string, string> = {
    ...(campaign === undefined ? {} : { campaign_id: campaign }),
    page: String(page),
  };
  return useQuery({
    queryKey: adminKeys.reports.list(query),
    queryFn: () => fetchReports(query),
  });
}

export function useReport(id: string) {
  return useQuery({ queryKey: adminKeys.reports.detail(id), queryFn: () => fetchReport(id) });
}

export function useEmailReport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: emailReport,
    onSettled: () => invalidateAfterWrite(queryClient, adminKeys.reports.all()),
  });
}
