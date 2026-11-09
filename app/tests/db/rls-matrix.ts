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
  agent_keys: { select: staffRoles, update: admin, delete: admin },
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
  // W6 item 8 (H142): the credit ledger, written only by payments_grant_credits and spend_client_credit.
  client_credits: staffRead,
  // B6: written only by next_invoice_number under the service role.
  invoice_counters: {},
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
  email_messages: staffRead,
  // W4: written only by email_reply_record under the service role.
  email_replies: staffRead,
  // W8 0h: written only by inbound_mail_record under the service role; read as privacy requests are (W8 0h review).
  inbound_mail: { select: ["chief_editor", "admin"] },
  // W8 0f: written only by studio_piece_put under the service role.
  studio_pieces: staffRead,
  email_suppressions: staffRead,
  email_events: staffRead,
  channel_settings: { select: staffRoles, insert: automation, update: automation },
  schedule_settings: { select: staffRoles, insert: automation, update: automation },
  automation_revisions: staffRead,
  event_fanout_failures: {},
  newsletter_issues: staffRead,
  // B10 step 6: written only through the social.sql functions under the service role.
  social_posts: staffRead,
  // W8 item 10: the same rule, written only through the proposed post functions.
  proposed_posts: staffRead,
  proposed_post_channels: staffRead,
  proposed_post_revisions: staffRead,
  // W1: staff read the office; every write is a workforce_* function or the daemon's claim under the service role.
  agents: staffRead,
  agent_messages: staffRead,
  agent_runs: staffRead,
  agent_approvals: staffRead,
  // W2 step 6: lessons and instruction versions, written only by workforce_decide and the laptop runner.
  agent_lessons: staffRead,
  agent_instruction_versions: staffRead,
  // W2 step 7: the meeting's decisions, written by the laptop runner.
  agent_decisions: staffRead,
  agent_activity: staffRead,
  // The laptop's vendor readings for the free-tier gauges, written only by record_vendor_usage.
  vendor_usage: staffRead,
};

/**
 * W6 item 7, ruling H119 (2): what a client (a signed-in person whose confirmed email is a contact's) may do to each
 * table, on their own rows. Nothing: the base tables carry staff-only columns, so a client's rows reach the room only
 * through `account_room`. A later slice that opens a row to a client lists the table and operation here.
 */
export const clientAccess: Partial<Record<string, readonly TableOperation[]>> = {};

/** Whether a client may run `op` on their own row of `table`; another client's row is always refused. */
export function clientAllows(table: string, op: TableOperation): boolean {
  return clientAccess[table]?.includes(op) ?? false;
}

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
