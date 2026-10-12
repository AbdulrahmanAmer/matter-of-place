// Admin pass (2026-10-12): the activity log in words. An action code (`automation.schedules_put`) reads as what
// happened ("Automation: schedules changed"), an entity as the thing it happened to; the code stays beside it for
// whoever searches by it.

const areas: Readonly<Record<string, string>> = {
  assets: "Visuals",
  audit: "Activity log",
  automation: "Automation",
  channels: "Social posts",
  dashboard: "Account",
  inquiries: "Inquiry",
  jobs: "Jobs",
  markets: "Market",
  media: "Photographs",
  newsletter: "Place Notes",
  payments: "Invoice",
  people: "People",
  properties: "Property",
  reports: "Report",
  retention: "Retention",
  settings: "Settings",
  stories: "Story",
  submissions: "Request",
  team: "Team and access",
  workforce: "AI team",
};

const verbs: Readonly<Record<string, string>> = {
  put: "changed",
  update: "changed",
  set: "changed",
  patch: "changed",
  create: "created",
  delete: "deleted",
  approve: "approved",
  unapprove: "approval withdrawn",
  publish: "published",
  unpublish: "taken down",
  accept: "accepted",
  decline: "declined",
  run: "ran",
  grant: "granted",
  revoke: "revoked",
  void: "voided",
  cancel: "cancelled",
  retry: "retried",
  export: "exported",
  issue: "issued",
  withdraw: "withdrawn",
  waive: "waived",
  password: "password changed",
  note: "note added",
};

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** "automation.schedules_put" as "Automation: schedules changed"; a code without a dot reads as itself. */
export function actionWords(action: string): string {
  const dot = action.indexOf(".");
  if (dot < 0) return capital(action.replaceAll("_", " "));
  const area = areas[action.slice(0, dot)] ?? capital(action.slice(0, dot).replaceAll("_", " "));
  const words = action.slice(dot + 1).split("_");
  const last = words.at(-1) ?? "";
  const verb = verbs[last];
  const object = (verb === undefined ? words : words.slice(0, -1)).join(" ");
  if (verb === undefined) return `${area}: ${object}`;
  return object === "" ? `${area} ${verb}` : `${area}: ${object} ${verb}`;
}

/** "schedule_settings" as "Schedule settings", with the first eight characters of its id when it has one. */
export function entityWords(entity: string, id: string | null): string {
  const name = capital(entity.replaceAll("_", " ").replaceAll(".", " "));
  return id === null ? name : `${name} ${id.slice(0, 8)}`;
}
