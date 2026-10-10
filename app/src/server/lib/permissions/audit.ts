import type { PermissionEntry } from "../authz.ts";

const readers = ["chief_editor", "admin"] as const;
// Data-subject requests (invariant 15): admin only, people only, and a recent sign-in.
const guarded = { roles: ["admin"], humanOnly: true, recentAuth: true } as const;
// B14: the weekly audit routine's reads (its agent key holds commercial with the scope audit, invariant 3).
const auditReaders = ["chief_editor", "managing_editor", "commercial", "admin"] as const;

export const audit = [
  { action: "audit.list", group: "audit", roles: readers },
  { action: "audit.subject_requests", group: "audit", roles: readers },
  { action: "audit.subject_export", group: "audit", ...guarded },
  { action: "audit.subject_delete", group: "audit", ...guarded },
  { action: "audit.subject_opt_out", group: "audit", ...guarded },
  { action: "audit.subject_status", group: "audit", ...guarded },
  { action: "audit.usage", group: "audit", roles: auditReaders },
  { action: "audit.health", group: "audit", roles: auditReaders },
  { action: "audit.notfound", group: "audit", roles: auditReaders },
  { action: "audit.kpis", group: "audit", roles: auditReaders },
  // G9: the routine's one write, `schedule_settings.last_run_at` of the audit row; agents allowed.
  { action: "audit.record_run", group: "audit", roles: ["commercial", "admin"] },
] as const satisfies readonly PermissionEntry[];
