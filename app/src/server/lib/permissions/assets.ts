import { appRoles } from "../../../domain/contracts.ts";
import type { PermissionEntry } from "../authz.ts";

// B9 (admin-screens 10, architecture 3.7): an agent key reaches these by scope `assets`; until B10, `approve_asset`
// and `approveAsset` refuse an agent with `manual_approval` whatever its roles.
const deciders = ["media_ops", "chief_editor"] as const;
// W8 item 9 (operator, 2026-10-16: "Matter should be able to reject those in my place"): a key rejects and asks for a
// re-render only as the owner-level agent, Matter, the one agent account granted `admin` (scripts/matter/key.ts; a
// grant is a person's, `team.role_grant`). A colleague's key is refused whatever its roles; approval stays a person's.
const owner = ["admin"] as const;

export const assets = [
  { action: "assets.list", group: "assets", roles: appRoles },
  { action: "assets.get", group: "assets", roles: appRoles },
  { action: "assets.approve", group: "assets", roles: deciders },
  { action: "assets.reject", group: "assets", roles: deciders, agentRoles: owner },
  { action: "assets.re_render", group: "assets", roles: deciders, agentRoles: owner },
  { action: "assets.caption", group: "assets", roles: deciders },
] as const satisfies readonly PermissionEntry[];
