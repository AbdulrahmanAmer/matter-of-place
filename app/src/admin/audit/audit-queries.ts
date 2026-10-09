import { useQuery } from "@tanstack/react-query";
import { adminKeys } from "../query";
import { fetchAuditLog } from "./audit-api";

export function useAuditLog(query: Readonly<Record<string, string>>) {
  return useQuery({
    queryKey: adminKeys.audit.list(query),
    queryFn: () => fetchAuditLog(query),
  });
}
