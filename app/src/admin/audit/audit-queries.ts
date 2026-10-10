import { useQuery } from "@tanstack/react-query";
import type { auditFilterNames } from "../../domain/admin-audit";
import { adminKeys } from "../query";
import { fetchAuditLog } from "./audit-api";

export type AuditFilters = Readonly<Partial<Record<(typeof auditFilterNames)[number], string>>>;

/** One page of screen 25: the filters of the address and its cursor, null on the first page. */
export function useAuditLog(filters: AuditFilters, cursor: string | null) {
  const query: Record<string, string> = { ...filters, ...(cursor === null ? {} : { cursor }) };
  return useQuery({
    queryKey: adminKeys.audit.list(query),
    queryFn: () => fetchAuditLog(query),
  });
}
