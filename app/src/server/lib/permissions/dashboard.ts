import { appRoles } from "../../../domain/contracts.ts";
import type { PermissionEntry } from "../authz.ts";

export const dashboard = [
  { action: "dashboard.get", group: "dashboard", roles: appRoles },
  // Any enabled agent key may read `me`, whatever its scopes (invariant 3).
  { action: "me", group: "dashboard", roles: appRoles, scopeFree: true },
] as const satisfies readonly PermissionEntry[];
