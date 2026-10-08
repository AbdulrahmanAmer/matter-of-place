import type { Json } from "../../../db/index.ts";
import {
  emailClasses,
  emailSettingsSchema,
  emailTemplateKeys,
  sampleVariables,
  type EmailTemplateKey,
} from "../../../domain/email.ts";
import { stepSpecs } from "../../automation/step-specs.ts";
import { attachmentResolvers, type EmailAttachment } from "../../email/attachments.ts";
import { loadSiteContext, readSettings, siteOf, type SiteContext } from "../../email/context.ts";
import { renderTemplate, type RenderedEmail } from "../../email/render.ts";
import { sendTransactional, type SendAnswer, type SendKind } from "../../email/resend-client.ts";
import {
  nextUtcBulkHour,
  nextUtcMidnight,
  nextUtcMonth,
  ResendError,
} from "../../email/resend-errors.ts";
import { isSuppressed } from "../../email/suppression.ts";
import {
  confirmTemplateKey,
  entityData,
  isEntityKind,
  resolveRecipient,
  resolveVariables,
  SkipSend,
} from "../../email/variables.ts";
import { sha256Hex } from "../../lib/crypto.ts";
import type { Db } from "../../lib/db.ts";
import { readVar } from "../../lib/runtime-env.ts";
import {
  NonRetryableError,
  type JsonObject,
  type StepContext,
  type StepDefinition,
  type StepResult,
} from "../types.ts";

// Step `send_email` and `sendOne`, the one path every email of the job runner takes to Resend (B5 invariants 4 to 6,
// 16). `email_messages` changes only through `email_message_begin` and `email_message_finish` (G43).

const spec = stepSpecs.send_email;

/** Statuses after which a message is out: a retry finds one of them and calls nothing (invariant 4). */
const OUT = new Set(["sent", "delivered", "bounced", "complained"]);

// G14: addresses on these top-level domains never exist, so no attempt may spend the quota on them.
const RESERVED = /\.(invalid|test|example)$/;

export interface SendOneInput {
  to: string;
  templateKey: string;
  kind: SendKind;
  entity?: string | null;
  entityId?: string | null;
  rendered: RenderedEmail;
  attachments?: readonly EmailAttachment[] | undefined;
}

export type SendOutcome =
  | { status: "sent"; resendId: string | null }
  | { status: "already_sent" }
  | { status: "skipped"; reason: string }
  | { status: "retry_at"; at: Date; reason: string };

export const isTemplateKey = (value: unknown): value is EmailTemplateKey =>
  emailTemplateKeys.some((key) => key === value);

const isClass = (value: string): value is SendKind => emailClasses.some((name) => name === value);

/** A Sentry report that can never fail the send it belongs to (invariant 14). */
export async function reportAlert(
  ctx: StepContext,
  error: Error,
  fingerprint: string[],
): Promise<void> {
  try {
    await ctx.report(error, { fingerprint, level: "warning" });
  } catch {
    ctx.log("warn", "alert_report_failed", { jobId: ctx.job.id });
  }
}

/** The `jobs.idempotency_key` of the running job, which every Idempotency-Key of its messages starts with. */
export async function jobIdempotencyKey(ctx: StepContext): Promise<string> {
  const { data, error } = await ctx.db
    .from("jobs")
    .select("idempotency_key")
    .eq("id", ctx.job.id)
    .limit(1);
  const key = data?.[0]?.idempotency_key;
  if (error !== null || key === undefined) throw new Error("email_read_failed:jobs");
  return key;
}

/** The type of the event that made the job, or undefined for a job no event made. */
export async function eventTypeOf(ctx: StepContext): Promise<string | undefined> {
  if (ctx.job.eventId === null) return undefined;
  const { data, error } = await ctx.db
    .from("events")
    .select("type")
    .eq("id", ctx.job.eventId)
    .limit(1);
  if (error !== null) throw new Error("email_read_failed:events");
  return data[0]?.type;
}

export async function templateRow(db: Db, key: EmailTemplateKey) {
  const { data, error } = await db
    .from("email_templates")
    .select("key, subject, preheader, body, class, enabled")
    .eq("key", key)
    .limit(1);
  if (error !== null) throw new Error("email_read_failed:email_templates");
  const row = data[0];
  if (row === undefined) throw new NonRetryableError("template_missing");
  return row;
}

// ---- sendOne -------------------------------------------------------------------------------------------------------

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** `*` stands for any run of characters before the `@` (invariant 6). */
export function allowListed(address: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) =>
    new RegExp(`^${pattern.split("*").map(escapeRegExp).join("[^@]*")}$`).test(address),
  );
}

async function skipReason(db: Db, address: string, devRecipients: readonly string[]) {
  if (RESERVED.test(address.split("@").at(-1) ?? "")) return "reserved_domain";
  if (readVar("MOP_ENV") !== "production" && !allowListed(address, devRecipients)) {
    return "not_allow_listed";
  }
  if (await isSuppressed(db, address)) return "suppressed";
  return null;
}

async function sentCount(db: Db, fn: "email_sent_today" | "email_sent_month"): Promise<number> {
  const { data, error } = await db.rpc(fn);
  if (error !== null) throw new Error(`email_read_failed:${fn}`);
  return data;
}

/** The ceiling of invariant 5 that stops this class now, as the time to try again; alerts have none. */
async function ceiling(
  db: Db,
  kind: SendKind,
  share: { daily_cap: number; bulk_cap: number; monthly_cap: number },
  now: Date,
): Promise<{ at: Date; reason: string } | null> {
  if (kind === "alert") return null;
  if ((await sentCount(db, "email_sent_month")) >= share.monthly_cap) {
    return { at: nextUtcMonth(now), reason: "monthly_cap" };
  }
  const today = await sentCount(db, "email_sent_today");
  if (kind === "bulk") {
    return today >= share.bulk_cap ? { at: nextUtcBulkHour(now), reason: "daily_cap_bulk" } : null;
  }
  return today >= share.daily_cap ? { at: nextUtcMidnight(now), reason: "daily_cap" } : null;
}

async function begin(ctx: StepContext, input: SendOneInput, contentHash: string) {
  const { data, error } = await ctx.db.rpc("email_message_begin", {
    p_job_id: ctx.job.id,
    p_to_email: input.to,
    p_template_key: input.templateKey,
    p_kind: input.kind,
    p_subject: input.rendered.subject,
    p_content_hash: contentHash,
    ...(input.entity == null ? {} : { p_entity: input.entity }),
    ...(input.entityId == null ? {} : { p_entity_id: input.entityId }),
  });
  const row = data?.[0];
  if (error !== null || row === undefined) throw new Error("email_message_begin_failed");
  return row;
}

async function finish(
  db: Db,
  id: string,
  status: "sent" | "failed" | "skipped",
  resendId: string | null,
  reason: string | null,
): Promise<void> {
  const { error } = await db.rpc("email_message_finish", {
    p_id: id,
    p_status: status,
    ...(resendId === null ? {} : { p_resend_id: resendId }),
    ...(reason === null ? {} : { p_error: reason }),
  });
  if (error !== null) throw new Error("email_message_finish_failed");
}

/** A send Resend refused, or that never reached it: recorded `failed` (or `sent` when Resend has it), then decided. */
async function refused(ctx: StepContext, id: string, error: unknown): Promise<SendOutcome> {
  if (!(error instanceof ResendError)) {
    await finish(
      ctx.db,
      id,
      "failed",
      null,
      error instanceof Error ? error.message : "send_failed",
    );
    throw error;
  }
  const { outcome } = error;
  if (outcome.kind === "already_sent") {
    await finish(ctx.db, id, "sent", null, "idempotent_conflict");
    await reportAlert(ctx, new Error("idempotent_conflict"), ["email", "idempotent_conflict"]);
    return { status: "sent", resendId: null };
  }
  await finish(ctx.db, id, "failed", null, error.code);
  if (outcome.kind === "retry_at") {
    if (outcome.reason === "monthly_quota_exceeded") {
      await reportAlert(ctx, error, ["alert", "resend_monthly_quota"]);
    }
    return { status: "retry_at", at: outcome.at, reason: outcome.reason };
  }
  if (outcome.kind === "fatal") throw new NonRetryableError(outcome.code);
  throw error;
}

/**
 * Sends one rendered email to one address, at most once per job and address: reserved domain, the dev allow-list,
 * suppression and the ceiling of `kind` are checked first, then the message row is begun, Resend is called with the
 * Idempotency-Key `<job key>:<first 12 hex of sha256(lower(to))>`, and the row is finished with what came back.
 */
export async function sendOne(ctx: StepContext, input: SendOneInput): Promise<SendOutcome> {
  const { db } = ctx;
  const address = input.to.toLowerCase();
  const settings = await readSettings(db, ["email", "site"]);
  const share = emailSettingsSchema.safeParse(settings.get("email"));
  if (!share.success) throw new NonRetryableError("email_settings_missing");
  const contentHash = await sha256Hex(`${input.rendered.subject}\n${input.rendered.html}`);

  const skip = await skipReason(db, address, share.data.dev_recipients);
  if (skip !== null) {
    const row = await begin(ctx, input, contentHash);
    await finish(db, row.id, "skipped", null, skip);
    return { status: "skipped", reason: skip };
  }
  const capped = await ceiling(db, input.kind, share.data, ctx.now);
  if (capped !== null) return { status: "retry_at", ...capped };

  const message = await begin(ctx, input, contentHash);
  if (OUT.has(message.status)) return { status: "already_sent" };
  if (message.content_hash !== contentHash) {
    ctx.log("warn", "email_content_changed", { messageId: message.id });
  }
  const idempotencyKey = `${await jobIdempotencyKey(ctx)}:${(await sha256Hex(address)).slice(0, 12)}`;
  const replyTo = siteOf(settings).contact.email ?? readVar("ADMIN_NOTIFY_EMAIL");
  let answer: SendAnswer;
  try {
    answer = await sendTransactional({
      to: input.to,
      subject: input.rendered.subject,
      html: input.rendered.html,
      text: input.rendered.text,
      kind: input.kind,
      idempotencyKey,
      replyTo,
      attachments: input.attachments,
      now: ctx.now,
      signal: ctx.signal,
    });
  } catch (error) {
    return refused(ctx, message.id, error);
  }
  if (answer.dryRun) {
    await finish(db, message.id, "skipped", answer.id, "dry_run");
    return { status: "skipped", reason: "dry_run" };
  }
  await finish(db, message.id, "sent", answer.id, null);
  return { status: "sent", resendId: answer.id };
}

function outcomeJson(outcome: Exclude<SendOutcome, { status: "retry_at" }>): Json {
  if (outcome.status === "sent") return { sent: outcome.resendId };
  if (outcome.status === "already_sent") return { already_sent: true };
  return { skipped: outcome.reason };
}

/** `sendOne` to each address in turn; a ceiling stops the run there, and the next run skips the ones already out. */
export async function sendEach(
  ctx: StepContext,
  addresses: readonly string[],
  message: Omit<SendOneInput, "to">,
): Promise<StepResult> {
  const results: Json[] = [];
  for (const to of addresses) {
    const outcome = await sendOne(ctx, { ...message, to });
    if (outcome.status === "retry_at") {
      return { status: "retry_at", at: outcome.at, reason: outcome.reason };
    }
    results.push(outcomeJson(outcome));
  }
  const [only] = results;
  return {
    status: "done",
    result: results.length === 1 && only !== undefined ? only : { messages: results },
  };
}

// ---- the step ------------------------------------------------------------------------------------------------------

const skipped = (reason: string): StepResult => ({ status: "done", result: { skipped: reason } });

const isConfirmKey = (key: EmailTemplateKey): boolean =>
  key === "interest_confirm" || key === "newsletter_confirm";

const textOf = (data: JsonObject, name: string): string | null => {
  const value = data[name];
  return typeof value === "string" ? value : null;
};

/** A test send shows the entity it names, else the sample variables. */
function testVariables(
  db: Db,
  key: EmailTemplateKey,
  data: JsonObject,
  site: SiteContext,
): Promise<Record<string, string>> {
  const kind = textOf(data, "entity");
  const id = textOf(data, "entity_id");
  if (kind === null || id === null || !isEntityKind(kind)) {
    return Promise.resolve(sampleVariables(key, site.siteUrl));
  }
  return resolveVariables(db, key, entityData(kind, id), undefined, site);
}

async function variablesFor(
  ctx: StepContext,
  key: EmailTemplateKey,
  data: JsonObject,
  site: SiteContext,
): Promise<Record<string, string>> {
  if (data["test"] === true) return testVariables(ctx.db, key, data, site);
  const eventType = key === "admin_notify" ? await eventTypeOf(ctx) : undefined;
  return resolveVariables(ctx.db, key, data, eventType, site);
}

async function run(ctx: StepContext, params: unknown, data: JsonObject): Promise<StepResult> {
  const parsed = spec.paramsSchema.parse(params);
  const named = parsed["template"];
  if (!isTemplateKey(named)) throw new NonRetryableError("template_unknown");
  const test = data["test"] === true;
  const key = !test && isConfirmKey(named) ? await confirmTemplateKey(ctx.db, data) : named;
  const row = await templateRow(ctx.db, key);
  if (!row.enabled) return skipped("template_disabled");
  if (key === "standalone" && !test) {
    // The Campaign email is one broadcast, not one message per address (B11 invariant 9). `standalone.ts` imports this
    // file and `audience.ts`, which imports it too, so a static import would close a circle: it is loaded when needed.
    const { sendStandalone } = await import("../../newsletter/standalone.ts");
    return sendStandalone(ctx, data);
  }
  if (!isClass(row.class)) throw new NonRetryableError("template_class_invalid");
  const to = parsed["to"];
  const recipient = await resolveRecipient(
    ctx.db,
    key,
    { to: typeof to === "string" ? to : undefined },
    data,
  );
  if (recipient.to.length === 0) return skipped("no_submitter");
  const site = await loadSiteContext(ctx.db);
  let variables: Record<string, string>;
  try {
    variables = await variablesFor(ctx, key, data, site);
  } catch (error) {
    if (error instanceof SkipSend) return skipped(error.reason);
    throw error;
  }
  const rendered = await renderTemplate(row, variables, site);
  const attachments =
    parsed["attach"] === "invoice_pdf"
      ? [await attachmentResolvers.invoice_pdf(ctx, data)]
      : undefined;
  return sendEach(ctx, recipient.to, {
    templateKey: key,
    kind: test ? "test" : row.class,
    entity: recipient.entity,
    entityId: recipient.entityId,
    rendered: test ? { ...rendered, subject: `[Test] ${rendered.subject}` } : rendered,
    attachments,
  });
}

export const sendEmail: StepDefinition = {
  type: spec.type,
  heavy: spec.heavy,
  paramsSchema: spec.paramsSchema,
  run,
};
