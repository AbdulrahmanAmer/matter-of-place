import { appRoles } from "../../../domain/contracts.ts";
import type { PermissionEntry } from "../authz.ts";

const editors = ["chief_editor", "managing_editor"] as const;
const writers = ["chief_editor", "managing_editor", "visual_editor"] as const;

export const properties = [
  { action: "properties.list", group: "properties", roles: appRoles },
  { action: "properties.get", group: "properties", roles: appRoles },
  { action: "properties.timeline", group: "properties", roles: appRoles },
  { action: "properties.representatives", group: "properties", roles: appRoles },
  { action: "properties.create_from_submission", group: "properties", roles: writers },
  // Also saves related properties and features.
  { action: "properties.update", group: "properties", roles: writers },
  { action: "properties.representative_put", group: "properties", roles: writers },
  { action: "properties.preview_token", group: "properties", roles: writers },
  { action: "properties.agent_preview", group: "properties", roles: writers },
  { action: "properties.revoke_previews", group: "properties", roles: writers },
  { action: "properties.publish", group: "properties", roles: editors },
  { action: "properties.unpublish", group: "properties", roles: editors },
  { action: "properties.rank", group: "properties", roles: editors },
] as const satisfies readonly PermissionEntry[];
