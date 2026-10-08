import { appRoles } from "../../../domain/contracts.ts";
import type { PermissionEntry } from "../authz.ts";

// Screen 13 (B11). Every role reads; the three editorial roles write. Approving sends mail nobody can take back, so a
// person approves, never an agent (invariant 3).
const editors = ["media_ops", "managing_editor", "chief_editor"] as const;

export const newsletter = [
  { action: "newsletter.issues_list", group: "newsletter", roles: appRoles },
  { action: "newsletter.issues_get", group: "newsletter", roles: appRoles },
  { action: "newsletter.preview", group: "newsletter", roles: appRoles },
  { action: "newsletter.subscribers_count", group: "newsletter", roles: appRoles },
  { action: "newsletter.build", group: "newsletter", roles: editors },
  { action: "newsletter.update", group: "newsletter", roles: editors },
  { action: "newsletter.send_test", group: "newsletter", roles: editors },
  { action: "newsletter.unapprove", group: "newsletter", roles: editors },
  { action: "newsletter.approve", group: "newsletter", roles: editors, humanOnly: true },
  { action: "newsletter.subscribers_export", group: "newsletter", roles: editors },
] as const satisfies readonly PermissionEntry[];
