import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { auditFilterNames } from "../../domain/admin-audit";
import { adminKeys, invalidateAfterWrite } from "../query";
import {
  fetchAuditLog,
  fetchSubjectRequests,
  postSubjectDelete,
  postSubjectExport,
  postSubjectOptOut,
  postSubjectStatus,
} from "./audit-api";

export type AuditFilters = Readonly<Partial<Record<(typeof auditFilterNames)[number], string>>>;

/** One page of screen 25: the filters of the address and its cursor, null on the first page. */
export function useAuditLog(filters: AuditFilters, cursor: string | null) {
  const query: Record<string, string> = { ...filters, ...(cursor === null ? {} : { cursor }) };
  return useQuery({
    queryKey: adminKeys.audit.list(query),
    queryFn: () => fetchAuditLog(query),
  });
}

/** One page of the data requests tab, under the audit key so each write reads it and the log again. */
export function useSubjectRequests(cursor: string | null) {
  return useQuery({
    queryKey: adminKeys.audit.list({ subject_requests: cursor }),
    queryFn: () => fetchSubjectRequests(cursor),
  });
}

function useAuditWrite<Input, Answer>(write: (input: Input) => Promise<Answer>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: write,
    onSettled: () => invalidateAfterWrite(queryClient, adminKeys.audit.all()),
  });
}

export const useSubjectStatus = () => useAuditWrite(postSubjectStatus);
export const useSubjectExport = () => useAuditWrite(postSubjectExport);
export const useSubjectDelete = () => useAuditWrite(postSubjectDelete);
export const useSubjectOptOut = () => useAuditWrite(postSubjectOptOut);
