import { appRoles } from "../../../domain/contracts.ts";
import type { PermissionEntry } from "../authz.ts";

const editors = ["chief_editor", "managing_editor"] as const;
const writers = ["chief_editor", "managing_editor", "visual_editor"] as const;

export const stories = [
  { action: "stories.list", group: "stories", roles: appRoles },
  { action: "stories.get", group: "stories", roles: appRoles },
  { action: "stories.write", group: "stories", roles: writers },
  { action: "stories.publish", group: "stories", roles: editors },
  { action: "stories.unpublish", group: "stories", roles: editors },
] as const satisfies readonly PermissionEntry[];
