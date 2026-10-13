import { appRoles } from "../../../domain/contracts.ts";
import type { PermissionEntry } from "../authz.ts";

// W1: every staff member sees the office and talks to the team; hiring, changing an employee and deciding an
// approval are for the chief editor and the administrator, and only a signed-in person does them (H101): an agent
// key, Matter's included, can never approve its own proposal or rewrite a colleague.
const deciders = ["chief_editor", "admin"] as const;

export const workforce = [
  { action: "workforce.office", group: "workforce", roles: appRoles },
  { action: "workforce.messages", group: "workforce", roles: appRoles },
  { action: "workforce.post_message", group: "workforce", roles: appRoles },
  { action: "workforce.hire", group: "workforce", roles: deciders, humanOnly: true },
  { action: "workforce.update", group: "workforce", roles: deciders, humanOnly: true },
  { action: "workforce.approvals", group: "workforce", roles: appRoles },
  { action: "workforce.decide", group: "workforce", roles: deciders, humanOnly: true },
] as const satisfies readonly PermissionEntry[];
