import { appRoles } from "../../../domain/contracts.ts";
import type { PermissionEntry } from "../authz.ts";

// Commercial reads inquiries and never changes them (S26).
const editors = ["chief_editor", "managing_editor"] as const;

export const inquiries = [
  { action: "inquiries.list", group: "inquiries", roles: appRoles },
  { action: "inquiries.get", group: "inquiries", roles: appRoles },
  { action: "inquiries.assignees", group: "inquiries", roles: appRoles },
  { action: "inquiries.assign", group: "inquiries", roles: editors },
  { action: "inquiries.forward", group: "inquiries", roles: editors },
  { action: "inquiries.close", group: "inquiries", roles: editors },
] as const satisfies readonly PermissionEntry[];
