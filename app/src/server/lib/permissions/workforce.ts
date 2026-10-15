import { appRoles } from "../../../domain/contracts.ts";
import type { PermissionEntry } from "../authz.ts";

// W1: every staff member sees the office and talks to the team; hiring, changing an employee and deciding an
// approval are for the chief editor and the administrator. The operator, 2026-10-15: Matter runs the operation in his
// place, so an agent key holding one of those roles (Matter's) does them too; what outside text proposes still waits
// in Approvals for that decision (H101), and money, keys, roles and privacy requests stay a person's (team, payments,
// audit).
const deciders = ["chief_editor", "admin"] as const;

export const workforce = [
  { action: "workforce.office", group: "workforce", roles: appRoles },
  { action: "workforce.messages", group: "workforce", roles: appRoles },
  { action: "workforce.post_message", group: "workforce", roles: appRoles },
  { action: "workforce.hire", group: "workforce", roles: deciders },
  { action: "workforce.update", group: "workforce", roles: deciders },
  { action: "workforce.approvals", group: "workforce", roles: appRoles },
  { action: "workforce.decide", group: "workforce", roles: deciders },
] as const satisfies readonly PermissionEntry[];
