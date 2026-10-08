import { z, type ZodType, type ZodTypeDef } from "zod";
import { adminPageSchema } from "../../domain/admin-page.ts";
import {
  channels,
  channelSettingsSchema,
  declineReasonSchema,
  recipeSchema,
  scheduleSettingsPutSchema,
  scheduleSettingsSchema,
  type ChannelSettings,
} from "../../domain/automation.ts";
import { emailTemplateKeys, emailTemplateSchema } from "../../domain/email.ts";
import { tiers } from "../../domain/events.ts";
import type { Flags } from "../../domain/flags.ts";
import { previewTemplate } from "../email/preview.ts";
import type { RenderedEmail } from "../email/render.ts";
import { fromRpcError } from "../lib/admin-errors.ts";
import type { AdminActor } from "../lib/admin-route.ts";
import { auditContext } from "../lib/audit.ts";
import { authorize, ForbiddenError } from "../lib/authz.ts";
import type { Db } from "../lib/db.ts";
import { AppError, fromZod } from "../lib/errors.ts";
import { getFlags } from "../lib/flags.ts";
import { getSpec } from "./catalog.ts";
import { dueAt, nextRun } from "./cron.ts";
import { dryRun, type DryRunResult } from "./dry-run.ts";

// `/api/admin/automation/*` (screens 17 to 21). Each write: authorize, parse, the payload-dependent agent guardrails,
// then exactly one RPC, which writes the row, its revision (by trigger) and its audit row in one transaction. The
// service makes no audit write of its own.

/** The clocks an agent may neither switch off nor re-time (SEC-11, ruling H23). */
const PROTECTED_SCHEDULES: readonly string[] = [
  "backup",
  "audit",
  "prune",
  "reconcile",
  "keepwarm",
];

const revisionTables = [
  "automation_recipes",
  "email_templates",
  "decline_reasons",
  "channel_settings",
  "schedule_settings",
] as const;

const uuid = z.string().uuid();

/** Every step's params parsed by its catalog spec, so an issue carries the path `steps[i].params.<key>`. */
const checkedSteps = recipeSchema.shape.steps.transform((steps, context) =>
  steps.map((step, index) => {
    const spec = getSpec(step.step_type);
    if (spec === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "There is no step of this type",
        path: [index, "step_type"],
      });
      return { ...step, params: {} };
    }
    const parsed = spec.paramsSchema.safeParse(step.params);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: issue.message,
          path: [index, "params", ...issue.path],
        });
      }
      return { ...step, params: {} };
    }
    // `send_email` and `notify_admin` name a template row of B5's closed set.
    const template = parsed.data["template"];
    if (template !== undefined && !emailTemplateKeys.some((key) => key === template)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "There is no email template with this key",
        path: [index, "params", "template"],
      });
    }
    return { ...step, params: parsed.data };
  }),
);

const recipeRowSchema = recipeSchema.extend({ steps: checkedSteps });

export const recipePutInput = recipeRowSchema
  .partial()
  .extend({ trigger: z.string().min(1).max(80) })
  .strict();

const templateFields = emailTemplateSchema.pick({
  subject: true,
  preheader: true,
  body: true,
  enabled: true,
});

export const templateKeyInput = z.object({ key: z.enum(emailTemplateKeys) });
export const templatePutInput = templateFields.partial().merge(templateKeyInput).strict();

export const templatePreviewInput = templateKeyInput
  .extend({ variables: z.record(z.string(), z.string().max(2000)).optional() })
  .strict();

export const reasonCreateInput = declineReasonSchema.strict();
export const reasonPutInput = declineReasonSchema.partial().extend({ id: uuid }).strict();
export const reasonOrderInput = z.object({ ids: z.array(uuid).min(1).max(200) }).strict();

export const channelPutInput = channelSettingsSchema
  .partial()
  .extend({ channel: z.enum(channels) })
  .strict();

const scheduleKey = z.string().min(1).max(40);
export const scheduleKeyInput = z.object({ key: scheduleKey });

function parsesAsCron(cron: string): boolean {
  try {
    nextRun(cron, new Date(0));
    return true;
  } catch {
    return false;
  }
}

export const schedulePutInput = scheduleSettingsPutSchema
  .extend({ key: scheduleKey })
  .refine((input) => input.cron === undefined || parsesAsCron(input.cron), {
    message: "This is not a cron the scheduler can read",
    path: ["cron"],
  });

export const dryRunInput = z
  .object({ trigger: z.string().min(1).max(80), entity_id: uuid.optional() })
  .strict();

export const revisionsInput = adminPageSchema.extend({
  table_name: z.enum(revisionTables).optional(),
  row_id: uuid.optional(),
});

const revisionCursor = z.tuple([z.string().datetime({ offset: true }), uuid]);

export const restoreInput = z.object({ id: uuid });

/** The service parses again, so a caller other than the route gets the same 422 the route gives. */
function parse<T>(schema: ZodType<T, ZodTypeDef, unknown>, raw: unknown): T {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw fromZod(parsed.error);
  return parsed.data;
}

async function call<T>(request: PromiseLike<{ data: T; error: unknown }>): Promise<T> {
  const { data, error } = await request;
  if (error !== null) throw fromRpcError(error);
  return data;
}

/** A read of rows; PostgREST answers null data only with an error, which `call` has thrown. */
async function rows<T>(request: PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  return (await call(request)) ?? [];
}

const notFound = (what: string) =>
  new AppError("not_found", undefined, `There is no such ${what}.`);

const humanOnly = () => new ForbiddenError("human_only");

type Approval = Pick<ChannelSettings, "approval_mode" | "auto_after">;

/** Automatic posting is a trust decision (S23): an agent may not set a tier to `auto` or move `auto_after`. */
function guardAgentApproval(
  current: Approval,
  next: {
    approval_mode?: Approval["approval_mode"] | undefined;
    auto_after?: string | null | undefined;
  },
): void {
  const raised = tiers.some(
    (tier) => next.approval_mode?.[tier] === "auto" && current.approval_mode[tier] !== "auto",
  );
  if (raised || (next.auto_after !== undefined && next.auto_after !== current.auto_after)) {
    throw humanOnly();
  }
}

/** An agent may not switch off or re-time a protected clock (SEC-11); the stored cron is read only when needed. */
async function guardSchedule(
  actor: AdminActor,
  key: string,
  next: { enabled?: boolean | undefined; cron?: string | undefined },
  storedCron: () => Promise<string>,
): Promise<void> {
  if (actor.kind !== "agent" || !PROTECTED_SCHEDULES.includes(key)) return;
  if (next.enabled === false) throw humanOnly();
  if (next.cron !== undefined && next.cron !== (await storedCron())) throw humanOnly();
}

const approvalRowSchema = channelSettingsSchema.pick({ approval_mode: true, auto_after: true });

async function readApproval(db: Db, column: "channel" | "id", value: string): Promise<Approval> {
  const found = await rows(
    db.from("channel_settings").select("approval_mode, auto_after").eq(column, value).limit(1),
  );
  const row = found[0];
  if (row === undefined) throw notFound("channel");
  return approvalRowSchema.parse(row);
}

async function readClock(
  db: Db,
  column: "key" | "id",
  value: string,
): Promise<{ key: string; cron: string }> {
  const found = await rows(
    db.from("schedule_settings").select("key, cron").eq(column, value).limit(1),
  );
  const row = found[0];
  if (row === undefined) throw notFound("schedule");
  return row;
}

/** `GET /api/admin/automation/recipes`: one recipe per event type. */
export async function getRecipes(actor: AdminActor, db: Db) {
  authorize(actor, "automation.get");
  return { items: await rows(db.from("automation_recipes").select("*").order("trigger")) };
}

/** `PUT /api/admin/automation/recipes/:trigger`. */
export async function putRecipe(actor: AdminActor, db: Db, raw: unknown) {
  authorize(actor, "automation.recipes_put");
  const { trigger, ...patch } = parse(recipePutInput, raw);
  return call(
    db.rpc("automation_put_recipe", { p_trigger: trigger, p_patch: patch, ...auditContext(actor) }),
  );
}

/** `GET /api/admin/automation/templates`. */
export async function getTemplates(actor: AdminActor, db: Db) {
  authorize(actor, "automation.get");
  return { items: await rows(db.from("email_templates").select("*").order("key")) };
}

/** `GET /api/admin/automation/templates/:key`. */
export async function getTemplate(actor: AdminActor, db: Db, raw: unknown) {
  authorize(actor, "automation.get");
  const { key } = parse(templateKeyInput, raw);
  const found = await rows(db.from("email_templates").select("*").eq("key", key).limit(1));
  const row = found[0];
  if (row === undefined) throw notFound("template");
  return row;
}

/** `PUT /api/admin/automation/templates/:key`: rows come from B5's seed; this edits and never creates. */
export async function putTemplate(actor: AdminActor, db: Db, raw: unknown) {
  authorize(actor, "automation.templates_put");
  const { key, ...patch } = parse(templatePutInput, raw);
  return call(
    db.rpc("automation_put_template", { p_key: key, p_patch: patch, ...auditContext(actor) }),
  );
}

/** `POST /api/admin/automation/templates/preview`: B5's render of the stored row; nothing is sent. */
export async function previewEmailTemplate(
  actor: AdminActor,
  db: Db,
  raw: unknown,
): Promise<RenderedEmail> {
  authorize(actor, "automation.templates_preview");
  const { key, variables } = parse(templatePreviewInput, raw);
  return previewTemplate(db, variables === undefined ? { key } : { key, variables });
}

/** `GET /api/admin/automation/reasons`, in the order of screen 19. */
export async function getReasons(actor: AdminActor, db: Db) {
  authorize(actor, "automation.get");
  return {
    items: await rows(db.from("decline_reasons").select("*").order("sort").order("code")),
  };
}

/** `POST /api/admin/automation/reasons`: a new reason goes last. */
export async function createReason(actor: AdminActor, db: Db, raw: unknown) {
  authorize(actor, "automation.reasons_put");
  const reason = parse(reasonCreateInput, raw);
  return call(db.rpc("automation_put_reason", { p_patch: reason, ...auditContext(actor) }));
}

/** `PUT /api/admin/automation/reasons/:id`. */
export async function putReason(actor: AdminActor, db: Db, raw: unknown) {
  authorize(actor, "automation.reasons_put");
  const { id, ...patch } = parse(reasonPutInput, raw);
  return call(
    db.rpc("automation_put_reason", { p_id: id, p_patch: patch, ...auditContext(actor) }),
  );
}

/** `PUT /api/admin/automation/reasons/order`: the ids in their new order; each moved row writes one revision. */
export async function reorderReasons(
  actor: AdminActor,
  db: Db,
  raw: unknown,
): Promise<{ ok: true }> {
  authorize(actor, "automation.reasons_put");
  const { ids } = parse(reasonOrderInput, raw);
  await call(db.rpc("automation_reorder_reasons", { p_ids: ids, ...auditContext(actor) }));
  return { ok: true };
}

/** `GET /api/admin/automation/channel-settings`. */
export async function getChannelSettings(actor: AdminActor, db: Db) {
  authorize(actor, "automation.get");
  return { items: await rows(db.from("channel_settings").select("*").order("channel")) };
}

/** `PUT /api/admin/automation/channel-settings/:channel`. */
export async function putChannelSettings(actor: AdminActor, db: Db, raw: unknown) {
  authorize(actor, "automation.channels_put");
  const { channel, ...patch } = parse(channelPutInput, raw);
  if (
    actor.kind === "agent" &&
    (patch.approval_mode !== undefined || patch.auto_after !== undefined)
  ) {
    guardAgentApproval(await readApproval(db, "channel", channel), patch);
  }
  return call(
    db.rpc("automation_put_channel", {
      p_channel: channel,
      p_patch: patch,
      ...auditContext(actor),
    }),
  );
}

type ScheduleRow = z.infer<typeof scheduleSettingsSchema> & { key: string };

/** A null `next_run_at` is shown as the time the scheduler will compute (invariant 12); nothing is stored. */
const withNextRun = (row: ScheduleRow, now: Date): ScheduleRow => ({
  ...row,
  next_run_at: row.next_run_at ?? dueAt(row, now).toISOString(),
});

const SCHEDULE_COLUMNS = "key, cron, interval_days, enabled, last_run_at, next_run_at";

/** `GET /api/admin/automation/schedule-settings`: the eight clocks. */
export async function getScheduleSettings(actor: AdminActor, db: Db, now = new Date()) {
  authorize(actor, "automation.get");
  const found = await rows(db.from("schedule_settings").select(SCHEDULE_COLUMNS).order("key"));
  return { items: found.map((row) => withNextRun(row, now)) };
}

/** `GET /api/admin/automation/schedule-settings/:key` (also the audit routine's read of its own row, B14). */
export async function getScheduleSetting(
  actor: AdminActor,
  db: Db,
  raw: unknown,
  now = new Date(),
) {
  authorize(actor, "automation.get");
  const { key } = parse(scheduleKeyInput, raw);
  const found = await rows(
    db.from("schedule_settings").select(SCHEDULE_COLUMNS).eq("key", key).limit(1),
  );
  const row = found[0];
  if (row === undefined) throw notFound("schedule");
  return withNextRun(row, now);
}

/**
 * `PUT /api/admin/automation/schedule-settings/:key`: `cron`, `interval_days`, `enabled` and `last_run_at` only. The
 * function refuses a `cron` change of an external clock with `external_clock` and clears `next_run_at`.
 */
export async function putScheduleSettings(actor: AdminActor, db: Db, raw: unknown) {
  authorize(actor, "automation.schedules_put");
  const { key, ...patch } = parse(schedulePutInput, raw);
  await guardSchedule(actor, key, patch, async () => (await readClock(db, "key", key)).cron);
  return call(
    db.rpc("automation_put_schedule", { p_key: key, p_patch: patch, ...auditContext(actor) }),
  );
}

/** `POST /api/admin/automation/dry-run`: what the planner would do, nothing written (invariant 3). */
export async function runDryRun(actor: AdminActor, db: Db, raw: unknown): Promise<DryRunResult> {
  authorize(actor, "automation.dry_run");
  const { trigger, entity_id } = parse(dryRunInput, raw);
  return dryRun(db, entity_id === undefined ? { trigger } : { trigger, entity_id });
}

/** `GET /api/admin/automation/revisions`: newest first, one keyset page of at most 50 (invariant 15 e). */
export async function listRevisions(actor: AdminActor, db: Db, raw: unknown) {
  authorize(actor, "automation.get");
  const input = parse(revisionsInput, raw);
  const newestFirst = () => {
    let query = db
      .from("automation_revisions")
      .select("id, table_name, row_id, before, after, actor_id, actor_kind, note, at");
    if (input.table_name !== undefined) query = query.eq("table_name", input.table_name);
    if (input.row_id !== undefined) query = query.eq("row_id", input.row_id);
    return query;
  };
  const take = (query: ReturnType<typeof newestFirst>) =>
    rows(
      query
        .order("at", { ascending: false })
        .order("id", { ascending: false })
        .limit(input.limit + 1),
    );
  let page;
  if (input.cursor === undefined) {
    page = await take(newestFirst());
  } else {
    const cursor = revisionCursor.safeParse(input.cursor.split("~"));
    if (!cursor.success) {
      throw new AppError("validation", undefined, "This page cursor is not valid.");
    }
    const [at, id] = cursor.data;
    // One change writes its revisions with one `at`: the rest of that instant first, then everything older.
    page = [
      ...(await take(newestFirst().eq("at", at).lt("id", id))),
      ...(await take(newestFirst().lt("at", at))),
    ];
  }
  const items = page.slice(0, input.limit);
  const last = items.at(-1);
  return {
    items,
    next_cursor: page.length > input.limit && last !== undefined ? `${last.at}~${last.id}` : null,
  };
}

const beforeSchemas: Record<
  (typeof revisionTables)[number],
  ZodType<unknown, ZodTypeDef, unknown>
> = {
  automation_recipes: recipeRowSchema,
  email_templates: emailTemplateSchema,
  decline_reasons: declineReasonSchema,
  channel_settings: channelSettingsSchema,
  schedule_settings: scheduleSettingsSchema,
};

const isRevisionTable = (name: string): name is (typeof revisionTables)[number] =>
  revisionTables.some((table) => table === name);

/**
 * `POST /api/admin/automation/revisions/:id/restore`: the revision's `before` must still parse with its table's
 * schema (422 with the path), and an agent may not restore what the guardrails refuse it as an edit.
 */
export async function restoreRevision(actor: AdminActor, db: Db, raw: unknown) {
  authorize(actor, "automation.revisions_restore");
  const { id } = parse(restoreInput, raw);
  const found = await rows(
    db.from("automation_revisions").select("table_name, row_id, before").eq("id", id).limit(1),
  );
  const revision = found[0];
  if (revision === undefined) throw notFound("revision");
  if (!isRevisionTable(revision.table_name)) {
    throw new Error(`a revision of an unknown table: ${revision.table_name}`);
  }
  if (revision.before !== null) {
    const before = parse(beforeSchemas[revision.table_name], revision.before);
    if (actor.kind === "agent" && revision.table_name === "channel_settings") {
      guardAgentApproval(
        await readApproval(db, "id", revision.row_id),
        approvalRowSchema.parse(before),
      );
    }
    if (actor.kind === "agent" && revision.table_name === "schedule_settings") {
      const clock = await readClock(db, "id", revision.row_id);
      await guardSchedule(actor, clock.key, scheduleSettingsSchema.parse(before), () =>
        Promise.resolve(clock.cron),
      );
    }
  }
  return call(db.rpc("automation_restore_revision", { p_revision_id: id, ...auditContext(actor) }));
}

/** `GET /api/admin/automation/flags`: the flags as every reader sees them, `coming_soon` included. */
export async function getFeatureFlags(actor: AdminActor, db: Db): Promise<Flags> {
  authorize(actor, "automation.get");
  return getFlags(db);
}

// The flags write lives with its reader in `src/server/lib/flags.ts`; a route imports only services (R11).
export { putFlags } from "../lib/flags.ts";
