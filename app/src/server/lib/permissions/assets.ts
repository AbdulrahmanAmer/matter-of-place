import { appRoles } from "../../../domain/contracts.ts";
import type { PermissionEntry } from "../authz.ts";

// B9 (admin-screens 10, architecture 3.7): an agent key reaches these by scope `assets`; until B10, `approve_asset`
// and `approveAsset` refuse an agent with `manual_approval` whatever its roles.
const deciders = ["media_ops", "chief_editor"] as const;

export const assets = [
  { action: "assets.list", group: "assets", roles: appRoles },
  { action: "assets.get", group: "assets", roles: appRoles },
  { action: "assets.approve", group: "assets", roles: deciders },
  { action: "assets.reject", group: "assets", roles: deciders },
  { action: "assets.re_render", group: "assets", roles: deciders },
  { action: "assets.caption", group: "assets", roles: deciders },
] as const satisfies readonly PermissionEntry[];
