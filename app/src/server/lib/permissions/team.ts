import type { PermissionEntry } from "../authz.ts";

// Admin only, people only, and a sign-in within the last 15 minutes (invariants 3 and 11).
const guarded = { roles: ["admin"], humanOnly: true, recentAuth: true } as const;

export const team = [
  { action: "team.users_list", group: "team", ...guarded },
  { action: "team.invite", group: "team", ...guarded },
  { action: "team.role_grant", group: "team", ...guarded },
  { action: "team.role_revoke", group: "team", ...guarded },
  { action: "team.user_disable", group: "team", ...guarded },
  { action: "team.agent_create", group: "team", ...guarded },
  { action: "team.agent_key_create", group: "team", ...guarded },
  { action: "team.agent_key_revoke", group: "team", ...guarded },
  { action: "team.revoke_all_keys", group: "team", ...guarded },
  { action: "team.limits_put", group: "team", ...guarded },
] as const satisfies readonly PermissionEntry[];
