import { appRoles } from "../../../domain/contracts.ts";
import type { PermissionEntry } from "../authz.ts";

const editors = ["chief_editor", "managing_editor"] as const;

export const markets = [
  { action: "markets.list", group: "markets", roles: appRoles },
  { action: "markets.get", group: "markets", roles: appRoles },
  { action: "markets.edit", group: "markets", roles: editors },
  { action: "markets.coming_soon", group: "markets", roles: editors },
] as const satisfies readonly PermissionEntry[];
