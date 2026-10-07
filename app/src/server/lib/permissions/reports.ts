import { appRoles } from "../../../domain/contracts.ts";
import type { PermissionEntry } from "../authz.ts";

// B10's Permissions table, screen 22. Export is the browser's print and writes nothing; `commercial` stays read-only
// (S26), so only the two editors email a report, and never an agent key (G22).
export const reports = [
  { action: "reports.list", group: "reports", roles: appRoles },
  { action: "reports.get", group: "reports", roles: appRoles },
  { action: "reports.export", group: "reports", roles: appRoles },
  {
    action: "reports.email",
    group: "reports",
    roles: ["managing_editor", "chief_editor"],
    humanOnly: true,
  },
] as const satisfies readonly PermissionEntry[];
