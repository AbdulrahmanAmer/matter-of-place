import type { PermissionEntry } from "../authz.ts";

// Admin only, people only, and a sign-in within the last 15 minutes (invariants 3 and 11).
// `settings.site_put` is the audit action of B16 and `settings.invoice_put` that of B6.
const guarded = { roles: ["admin"], humanOnly: true, recentAuth: true } as const;

export const settings = [
  { action: "settings.get", group: "settings", ...guarded },
  { action: "settings.site_put", group: "settings", ...guarded },
  { action: "settings.invoice_put", group: "settings", ...guarded },
  { action: "settings.coming_soon_put", group: "settings", ...guarded },
  { action: "settings.notifications_put", group: "settings", ...guarded },
  { action: "settings.redirects_get", group: "settings", ...guarded },
  { action: "settings.redirects_put", group: "settings", ...guarded },
] as const satisfies readonly PermissionEntry[];
