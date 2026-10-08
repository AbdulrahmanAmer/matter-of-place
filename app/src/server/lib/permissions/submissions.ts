import { appRoles } from "../../../domain/contracts.ts";
import type { PermissionEntry } from "../authz.ts";

const editors = ["chief_editor", "managing_editor"] as const;
// ASSUMED: "all editors" are the four editorial roles.
const noters = ["chief_editor", "managing_editor", "visual_editor", "media_ops"] as const;

// `submissions.activate` is registered by B6 in `payments.ts`. A withdrawal that voids a due invoice also needs
// `payments.void` (DL-04), which the service checks.
export const submissions = [
  { action: "submissions.list", group: "submissions", roles: appRoles },
  { action: "submissions.get", group: "submissions", roles: appRoles },
  { action: "submissions.timeline", group: "submissions", roles: appRoles },
  { action: "submissions.start_review", group: "submissions", roles: editors },
  { action: "submissions.decline", group: "submissions", roles: editors },
  { action: "submissions.accept", group: "submissions", roles: editors },
  { action: "submissions.request_assets", group: "submissions", roles: editors },
  { action: "submissions.assets_received", group: "submissions", roles: editors },
  { action: "submissions.email_preview", group: "submissions", roles: editors },
  { action: "submissions.decline_reasons", group: "submissions", roles: editors },
  { action: "submissions.note", group: "submissions", roles: noters },
  {
    action: "submissions.withdraw",
    group: "submissions",
    roles: ["managing_editor", "admin"],
    humanOnly: true,
  },
] as const satisfies readonly PermissionEntry[];
