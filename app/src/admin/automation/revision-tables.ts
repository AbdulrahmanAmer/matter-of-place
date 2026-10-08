/** The five tables the revisions cover, named as the person knows them, and the column that names a row in each. */
export const revisionTables = {
  automation_recipes: { label: "Recipe", name: "trigger" },
  email_templates: { label: "Email", name: "key" },
  decline_reasons: { label: "Decline reason", name: "code" },
  channel_settings: { label: "Channel", name: "channel" },
  schedule_settings: { label: "Schedule", name: "key" },
} as const;
