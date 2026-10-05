import type { PermissionEntry } from "../authz.ts";

const readers = ["chief_editor", "admin"] as const;
// Data-subject requests (invariant 15): admin only, people only, and a recent sign-in.
const guarded = { roles: ["admin"], humanOnly: true, recentAuth: true } as const;

export const audit = [
  { action: "audit.list", group: "audit", roles: readers },
  { action: "audit.subject_requests", group: "audit", roles: readers },
  { action: "audit.subject_export", group: "audit", ...guarded },
  { action: "audit.subject_delete", group: "audit", ...guarded },
  { action: "audit.subject_opt_out", group: "audit", ...guarded },
  { action: "audit.subject_status", group: "audit", ...guarded },
] as const satisfies readonly PermissionEntry[];
