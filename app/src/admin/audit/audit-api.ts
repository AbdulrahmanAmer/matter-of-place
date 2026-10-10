import { auditPageSchema } from "../../domain/admin-audit";
import { adminFetch } from "../ui/admin-fetch";

// The browser side of screen 25. Components reach this through `audit-queries.ts`.

/** One page of the audit log; `query` holds the filters and the cursor exactly as the address has them. */
export function fetchAuditLog(query: Readonly<Record<string, string>>) {
  const search = new URLSearchParams(query).toString();
  return adminFetch(`/api/admin/audit${search === "" ? "" : `?${search}`}`, auditPageSchema);
}
