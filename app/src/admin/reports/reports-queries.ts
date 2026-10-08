import { useMutation, useQuery } from "@tanstack/react-query";
import { adminKeys } from "../query";
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

/** Emailing writes an audit row and a job, and changes nothing the screen shows, so no query is refreshed. */
export const useEmailReport = () => useMutation({ mutationFn: emailReport });
