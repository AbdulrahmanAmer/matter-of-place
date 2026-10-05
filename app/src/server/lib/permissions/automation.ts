import { appRoles } from "../../../domain/contracts.ts";
import type { PermissionEntry } from "../authz.ts";

// B8b's Permissions table. Its rows arrive with B7's `write_audit`, which refuses an action no `action_roles` row
// holds, and B8b's guarded put functions call it from the moment it exists (P-2000).
const writers = ["chief_editor", "media_ops", "admin"] as const;

export const automation = [
  { action: "automation.get", group: "automation", roles: appRoles },
  { action: "automation.recipes_put", group: "automation", roles: writers },
  { action: "automation.templates_put", group: "automation", roles: writers },
  { action: "automation.channels_put", group: "automation", roles: writers },
  { action: "automation.schedules_put", group: "automation", roles: writers },
  { action: "automation.dry_run", group: "automation", roles: writers },
  {
    action: "automation.reasons_put",
    group: "automation",
    roles: ["chief_editor", "managing_editor", "admin"],
  },
  {
    action: "automation.revisions_restore",
    group: "automation",
    roles: ["chief_editor", "admin"],
  },
  { action: "automation.flags_put", group: "automation", roles: ["admin"], humanOnly: true },
  {
    action: "automation.templates_preview",
    group: "automation",
    roles: ["chief_editor", "managing_editor", "media_ops", "admin"],
  },
  { action: "automation.templates_send_test", group: "automation", roles: writers },
] as const satisfies readonly PermissionEntry[];
