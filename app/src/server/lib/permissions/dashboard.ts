import { appRoles } from "../../../domain/contracts.ts";
import type { PermissionEntry } from "../authz.ts";

export const dashboard = [
  { action: "dashboard.get", group: "dashboard", roles: appRoles },
  // Any enabled agent key may read `me`, whatever its scopes (invariant 3).
  { action: "me", group: "dashboard", roles: appRoles, scopeFree: true },
  // A person sets their own password, after a recent sign-in; an agent key has none (operator, 2026-10-12).
  {
    action: "dashboard.password",
    group: "dashboard",
    roles: appRoles,
    humanOnly: true,
    recentAuth: true,
  },
] as const satisfies readonly PermissionEntry[];
