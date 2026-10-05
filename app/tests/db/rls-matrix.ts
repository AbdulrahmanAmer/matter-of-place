// Architecture 3.7 as data, the statement of migration 10 (STANDARDS R20): what an authenticated user holding a role
// may do to each table in `public`. `authenticated` holds a table privilege exactly where some role holds the
// operation, so rls.db.test.ts proves a grant and its policy together. Later slices add their tables here.
export const staffRoles = [
  "chief_editor",
  "managing_editor",
  "visual_editor",
  "media_ops",
  "commercial",
  "admin",
] as const;
export type StaffRole = (typeof staffRoles)[number];

export const tableOperations = ["select", "insert", "update", "delete"] as const;
export type TableOperation = (typeof tableOperations)[number];

export type Access = Partial<Record<TableOperation, readonly StaffRole[]>>;

const staffRead: Access = { select: staffRoles };
const editors = ["chief_editor", "managing_editor", "admin"] as const;
const admin = ["admin"] as const;
const automation = ["chief_editor", "media_ops", "admin"] as const;

export const rlsMatrix: Record<string, Access> = {
  migration_checksums: {},
  pii_columns: {},
  action_roles: {},
  user_roles: { select: staffRoles, insert: admin, update: admin },
  agent_keys: { select: staffRoles, insert: admin, update: admin, delete: admin },
  audit_log: staffRead,
  markets: staffRead,
  regions: staffRead,
  market_notes: staffRead,
  market_guide_entries: staffRead,
  representatives: staffRead,
  properties: {
    select: staffRoles,
    insert: ["chief_editor", "managing_editor", "visual_editor"],
    update: ["chief_editor", "managing_editor", "visual_editor"],
  },
  property_media: staffRead,
  property_features: staffRead,
  property_related: staffRead,
  stories: staffRead,
  settings: staffRead,
  slug_history: staffRead,
  redirects: { select: staffRoles, insert: editors, update: editors },
  retention_policies: { select: staffRoles, update: admin },
  contacts: staffRead,
  decline_reasons: { select: staffRoles, insert: editors, update: editors },
  submissions: { select: staffRoles, update: ["chief_editor", "managing_editor"] },
  submission_media: staffRead,
  inquiries: { select: staffRoles, update: editors },
  subscribers: { select: staffRoles, update: admin },
  analytics_events: staffRead,
  payments: {
    select: staffRoles,
    insert: ["managing_editor", "admin"],
    update: ["managing_editor", "admin"],
  },
  campaigns: staffRead,
  campaign_reports: staffRead,
  // B3: only the service role reaches the first two; privacy requests are for admin and chief_editor (admin screens 25).
  rate_limits: {},
  webhook_receipts: {},
  subject_requests: { select: ["chief_editor", "admin"], update: ["chief_editor", "admin"] },
  events: staffRead,
  jobs: staffRead,
  job_events: staffRead,
  // B8 step 6a: written by beat() and read by ops_health(), both service role only.
  ops_heartbeats: {},
  analytics_daily: staffRead,
  // B9: written only through the asset functions under the service role; media_ops and chief_editor may update.
  assets: { select: staffRoles, update: ["media_ops", "chief_editor"] },
  // B8b step 1: recipes are never inserted or deleted (invariant 8), revisions come from a trigger, and only the
  // service role reaches the fan-out retry rows (JOB-07). decline_reasons keeps B2's row above.
  automation_recipes: { select: staffRoles, update: automation },
  email_templates: { select: staffRoles, insert: automation, update: automation },
  channel_settings: { select: staffRoles, insert: automation, update: automation },
  schedule_settings: { select: staffRoles, insert: automation, update: automation },
  automation_revisions: staffRead,
  event_fanout_failures: {},
};

/**
 * The only functions in `public` or `app` that `authenticated` may execute. The policies call these two, and they sit
 * in `app`, outside the API, so no one reaches them through /rest/v1/rpc (security advisor lint 0029).
 */
export const authenticatedFunctions = ["app.is_staff", "app.role_in"];

/** Whether a user holding `roles` may run `op` on `table`; a user holds the union of its roles. */
export function allows(table: string, op: TableOperation, roles: readonly StaffRole[]): boolean {
  const allowed = rlsMatrix[table]?.[op] ?? [];
  return roles.some((role) => allowed.includes(role));
}
