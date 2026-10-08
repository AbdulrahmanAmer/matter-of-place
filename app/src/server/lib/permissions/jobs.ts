import { appRoles } from "../../../domain/contracts.ts";
import type { PermissionEntry } from "../authz.ts";

const operators = ["media_ops", "admin"] as const;

// B8 step 9: screen 16. Approval is the human gate of S23 and S46, and retrying every matching dead job at once is a
// person's decision (E2E-03): both are humanOnly.
export const jobs = [
  { action: "jobs.list", group: "jobs", roles: appRoles },
  { action: "jobs.get", group: "jobs", roles: appRoles },
  { action: "jobs.retry", group: "jobs", roles: operators },
  { action: "jobs.cancel", group: "jobs", roles: operators },
  { action: "jobs.approve", group: "jobs", roles: operators, humanOnly: true },
  { action: "jobs.retry_bulk", group: "jobs", roles: operators, humanOnly: true },
] as const satisfies readonly PermissionEntry[];
