import { appRoles } from "../../../domain/contracts.ts";
import type { PermissionEntry } from "../authz.ts";

const issuers = ["managing_editor", "admin"] as const;

// B6: invoices and payments. Recording money and activating a submission is a person's act (humanOnly).
export const payments = [
  { action: "payments.list", group: "payments", roles: appRoles },
  { action: "payments.get", group: "payments", roles: appRoles },
  { action: "payments.pdf", group: "payments", roles: appRoles },
  { action: "payments.issue", group: "payments", roles: issuers },
  { action: "payments.mark_paid", group: "payments", roles: issuers, humanOnly: true },
  // Also a waiver recorded without an invoice (`POST /api/admin/submissions/:id/waive`, invariant 12).
  { action: "payments.waive", group: "payments", roles: issuers, humanOnly: true },
  { action: "payments.void", group: "payments", roles: ["admin"], humanOnly: true },
  { action: "submissions.activate", group: "submissions", roles: issuers, humanOnly: true },
] as const satisfies readonly PermissionEntry[];
