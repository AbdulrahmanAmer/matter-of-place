import { appRoles } from "../../../domain/contracts.ts";
import type { PermissionEntry } from "../authz.ts";

const writers = ["chief_editor", "managing_editor", "visual_editor"] as const;

export const media = [
  { action: "media.list", group: "media", roles: appRoles },
  { action: "media.variants_status", group: "media", roles: appRoles },
  { action: "media.upload_url", group: "media", roles: writers },
  { action: "media.attach", group: "media", roles: writers },
  { action: "media.reorder", group: "media", roles: writers },
  { action: "media.alt", group: "media", roles: writers },
  { action: "media.replace", group: "media", roles: writers },
  { action: "media.delete", group: "media", roles: writers },
] as const satisfies readonly PermissionEntry[];
