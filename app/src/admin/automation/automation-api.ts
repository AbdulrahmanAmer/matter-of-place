import { z } from "zod";
import {
  channels,
  channelSettingsSchema,
  declineReasonSchema,
  emailTemplateSchema,
  scheduleSettingsSchema,
  skipReasons,
  stepSchema,
} from "../../domain/automation";
import type { EmailBlock, EmailTemplateKey } from "../../domain/email";
import type { FeatureFlag, Flags } from "../../domain/flags";
import { adminFetch } from "../ui/admin-fetch";

// The browser side of screens 17 to 20 and the flags of screen 24. Components reach these through `automation-queries.ts`.

const fieldKinds = ["text", "number", "select", "multiselect", "boolean"] as const;

const fieldSchema = z.object({
  key: z.string(),
  label: z.string(),
  kind: z.enum(fieldKinds),
  required: z.boolean().optional(),
  options: z.array(z.object({ value: z.string(), label: z.string() })).optional(),
  default: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  hint: z.string().optional(),
});

/** One entry of the step catalog, as `GET /api/admin/automation/recipes` sends it (`step-specs.ts` without its Zod schema). */
const stepSpecSchema = z.object({
  type: z.string(),
  label: z.string(),
  description: z.string(),
  heavy: z.boolean(),
  local: z.boolean(),
  implemented: z.boolean(),
  fields: z.array(fieldSchema),
});

const recipeRowSchema = z.object({
  id: z.string(),
  trigger: z.string(),
  name: z.string(),
  enabled: z.boolean(),
  steps: z.array(stepSchema),
  version: z.number(),
});

const recipeListSchema = z.object({
  items: z.array(recipeRowSchema),
  steps: z.array(stepSpecSchema),
});

const dryRunSchema = z.object({
  trigger: z.string(),
  recipe_enabled: z.boolean(),
  planned: z.array(
    z.object({
      step_id: z.string(),
      type: z.string(),
      heavy: z.boolean(),
      run_local: z.boolean(),
      status: z.enum(["queued", "waiting_approval"]),
    }),
  ),
  skipped: z.array(
    z.object({ step_id: z.string(), type: z.string(), reason: z.enum(skipReasons) }),
  ),
  warnings: z.array(
    z.object({ code: z.string(), step_id: z.string().nullable(), message: z.string() }),
  ),
});

const templateListSchema = z.object({ items: z.array(emailTemplateSchema) });

/** What B5's `renderTemplate` answers; the browser draws `html` in a frame and shows the other three as text. */
const previewSchema = z.object({
  subject: z.string(),
  preheader: z.string(),
  html: z.string(),
  text: z.string(),
});

const sendTestSchema = z.object({ queued: z.boolean(), to: z.string() });

const reasonRowSchema = declineReasonSchema.required({ sort: true }).extend({ id: z.string() });

const reasonListSchema = z.object({ items: z.array(reasonRowSchema) });

// `credentials_ref` is left out on purpose: it names a secret, and a key the schema does not list never reaches the page (G-006).
const channelRowSchema = channelSettingsSchema
  .omit({ credentials_ref: true })
  .extend({ channel: z.enum(channels) });

const channelListSchema = z.object({ items: z.array(channelRowSchema) });

const scheduleRowSchema = scheduleSettingsSchema.extend({ key: z.string() });

const scheduleListSchema = z.object({ items: z.array(scheduleRowSchema) });

const flagsAnswerSchema = z.object({
  new_channels: z.boolean(),
  archive_pages: z.boolean(),
  csp_enforce: z.boolean(),
  maintenance: z.boolean(),
  coming_soon: z.boolean(),
}) satisfies z.ZodType<Flags>;

const flagsSavedSchema = flagsAnswerSchema.omit({ coming_soon: true });

const reasonsPath = "/api/admin/automation/reasons";

export type StepField = z.infer<typeof fieldSchema>;
export type StepSpecView = z.infer<typeof stepSpecSchema>;
export type RecipeRow = z.infer<typeof recipeRowSchema>;
export type { Step } from "../../domain/automation";
export type TemplateRow = z.infer<typeof emailTemplateSchema>;
export type ReasonRow = z.infer<typeof reasonRowSchema>;
export type ChannelRow = z.infer<typeof channelRowSchema>;
export type ScheduleRow = z.infer<typeof scheduleRowSchema>;

/** What a save sends: the four keys the server's `templatePutInput` accepts beside the key in the path. */
export interface TemplatePatch {
  subject: string;
  preheader: string;
  enabled: boolean;
  body: readonly EmailBlock[];
}

/** What a new reason sends: `sort` is left out, a new reason goes last. */
export type ReasonDraft = Pick<ReasonRow, "code" | "label" | "email_paragraph" | "enabled">;

/** What an edit sends: the code stays, it is what the emails and submissions name. */
export type ReasonPatch = Omit<ReasonDraft, "code">;

/** What a save sends for one channel: the four keys of `channelPutInput` the screen edits. */
export type ChannelPatch = Pick<
  ChannelRow,
  "enabled" | "posting_window" | "approval_mode" | "auto_after"
>;

/** What a save sends for one clock: the keys of `schedulePutInput` the screen edits. */
export type SchedulePatch = Partial<Pick<ScheduleRow, "cron" | "interval_days" | "enabled">>;

/** What a save sends: the three keys the server's `recipePutInput` accepts beside the trigger in the path. */
export interface RecipePatch {
  name: string;
  enabled: boolean;
  steps: readonly z.infer<typeof stepSchema>[];
}

export function fetchRecipes() {
  return adminFetch("/api/admin/automation/recipes", recipeListSchema);
}

export function putRecipe(trigger: string, patch: RecipePatch) {
  return adminFetch(
    `/api/admin/automation/recipes/${encodeURIComponent(trigger)}`,
    recipeRowSchema,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    },
  );
}

/** What the planner would do with the saved recipe of `trigger`; `entityId` builds the sample from that row. */
export function runDryRun(trigger: string, entityId: string | undefined) {
  return adminFetch("/api/admin/automation/dry-run", dryRunSchema, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(entityId === undefined ? { trigger } : { trigger, entity_id: entityId }),
  });
}

export function fetchTemplates() {
  return adminFetch("/api/admin/automation/templates", templateListSchema);
}

export function putTemplate(key: EmailTemplateKey, patch: TemplatePatch) {
  return adminFetch(`/api/admin/automation/templates/${key}`, emailTemplateSchema, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
}

/** The saved template drawn by B5's renderer; `variables` sit on top of the sample values. Nothing is sent. */
export function fetchPreview(key: EmailTemplateKey, variables: Readonly<Record<string, string>>) {
  return adminFetch("/api/admin/automation/templates/preview", previewSchema, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ key, variables }),
  });
}

/** Queues one test of the saved template to the signed-in person. */
export function postSendTest(key: EmailTemplateKey) {
  return adminFetch(`/api/admin/automation/templates/${key}/send-test`, sendTestSchema, {
    method: "POST",
  });
}

export function fetchReasons() {
  return adminFetch(reasonsPath, reasonListSchema);
}

export function postReason(draft: ReasonDraft) {
  return adminFetch(reasonsPath, reasonRowSchema, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(draft),
  });
}

export function putReason(id: string, patch: ReasonPatch) {
  return adminFetch(`${reasonsPath}/${id}`, reasonRowSchema, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
}

/** All ids in the order wanted; the server writes one revision for each row that moved. */
export function putReasonOrder(ids: readonly string[]) {
  return adminFetch(`${reasonsPath}/order`, z.object({ ok: z.literal(true) }), {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ids }),
  });
}

export function fetchChannelSettings() {
  return adminFetch("/api/admin/automation/channel-settings", channelListSchema);
}

export function putChannelSettings(channel: ChannelRow["channel"], patch: ChannelPatch) {
  return adminFetch(`/api/admin/automation/channel-settings/${channel}`, channelRowSchema, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
}

export function fetchScheduleSettings() {
  return adminFetch("/api/admin/automation/schedule-settings", scheduleListSchema);
}

export function putScheduleSettings(key: string, patch: SchedulePatch) {
  return adminFetch(
    `/api/admin/automation/schedule-settings/${encodeURIComponent(key)}`,
    scheduleRowSchema,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    },
  );
}

export function fetchFlags() {
  return adminFetch("/api/admin/automation/flags", flagsAnswerSchema);
}

/** The flags named in `patch`; a flag the request leaves out keeps its value. */
export function putFlags(patch: Partial<Record<FeatureFlag, boolean>>) {
  return adminFetch("/api/admin/automation/flags", flagsSavedSchema, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
}
