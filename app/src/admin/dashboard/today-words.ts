// W3 stage 4: the Today page in words. A failed health check and a line of the activity log are said as a person
// would say them; an id with no words here falls back to a readable form of itself.

const checks: Readonly<Record<string, string>> = {
  captions_waiting: "captions have waited too long for the laptop",
  dead_jobs_24h: "some jobs failed for good in the last day",
  stale_queue: "jobs are waiting longer than they should",
  cron_failures: "a scheduled task failed",
  retention_stalled: "the nightly clean-up had not run",
  long_waits: "some jobs have waited more than a week",
  backup_fresh: "the latest backup is too old",
  site_identity: "the site's public details did not refresh",
  usage_gauges: "a free-tier limit is close",
};

/** "the nightly clean-up had not run", or the check's own name in words. */
export function checkWords(name: string): string {
  return checks[name] ?? name.replaceAll("_", " ");
}

const actions: Readonly<Record<string, string>> = {
  "automation.schedules_put": "Changed a schedule",
  "automation.recipes_put": "Changed a flow",
  "automation.channels_put": "Changed a channel",
  "dashboard.password": "Set a password",
  "workforce.update": "Updated an AI colleague",
  "workforce.hire": "Added an AI colleague",
  "workforce.decide": "Decided on a proposal",
  "team.agent_key_create": "Created an agent key",
  "team.agent_key_revoke": "Revoked an agent key",
  "team.role_grant": "Gave a role",
  "team.role_revoke": "Took back a role",
  "team.invite": "Invited a team member",
  "retention.run": "Ran the nightly clean-up",
  "submissions.start_review": "Started reviewing a request",
  "submissions.accept": "Accepted a request",
  "submissions.decline": "Declined a request",
  "properties.publish": "Published a property",
  "properties.unpublish": "Took down a property",
  "invoices.issue": "Sent an invoice",
  "invoices.mark_paid": "Recorded a payment",
  "settings.site_put": "Changed the site details",
  "audit.record_run": "Ran the Saturday audit",
};

/** "Changed a schedule"; an action with no words reads "Automation: schedules put". */
export function actionWords(action: string): string {
  const known = actions[action];
  if (known !== undefined) return known;
  const text = action.replace(".", ": ").replaceAll("_", " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}
