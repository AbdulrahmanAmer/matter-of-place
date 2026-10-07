import { appRoles } from "../../../domain/contracts.ts";
import type { PermissionEntry } from "../authz.ts";

// B10's Permissions table, screen 12. Retry, cancel and refresh match the screen 16 pattern (ASSUMED); marking a
// takedown withdrawn and storing account ids are a person's acts (API-02).
const operators = ["media_ops", "chief_editor", "admin"] as const;

export const channels = [
  { action: "channels.posts_list", group: "channels", roles: appRoles },
  { action: "channels.health", group: "channels", roles: appRoles },
  { action: "channels.retry", group: "channels", roles: operators },
  { action: "channels.cancel", group: "channels", roles: operators },
  { action: "channels.metrics_refresh", group: "channels", roles: operators },
  { action: "channels.mark_withdrawn", group: "channels", roles: operators, humanOnly: true },
  { action: "channels.ids_put", group: "channels", roles: ["media_ops", "admin"], humanOnly: true },
] as const satisfies readonly PermissionEntry[];
