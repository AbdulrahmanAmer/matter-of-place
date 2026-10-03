// How long personal data is kept before the daily retention job removes or anonymises it (invariant 8, G16, G43).
// The keys are the `retention_policies` row keys; each value has exactly one unit. The privacy page prints these
// numbers and a database test compares them with the rows, so a period changes here and in its row together.
export const retentionPeriods = {
  declined_submission_media: { days: 90 },
  inquiries_anonymise: { months: 24 },
  subject_requests: { months: 24 },
  analytics_events: { months: 13 },
  unconfirmed_subscribers: { days: 30 },
  email_pii: { days: 90 },
  rate_limits: { hours: 25 },
} as const;
