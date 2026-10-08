import { z } from "zod";
import type { EmailTemplateKey } from "../../domain/email.ts";
import { NonRetryableError, type JsonObject } from "../jobs/types.ts";
import type { Db } from "../lib/db.ts";
import { readVar } from "../lib/runtime-env.ts";
import { openToken } from "../subscribers/confirm-email.ts";
import {
  loadSiteContext,
  readSettings,
  resolveAdminRecipients,
  type SiteContext,
} from "./context.ts";
import { formatCount, formatDate, formatPercent, formatUsd } from "./format.ts";
import { interpolate } from "./render.ts";

// The two questions a send asks of the database: who gets this email, and what do its variables say. Every read is
// by id (an id of the job's event payload) and every answer is a plain string, so a template never sees a row.

/** Who a send goes to; `entity` and `entityId` are written to `email_messages` so a message can be traced to its row. */
export interface Recipient {
  to: string[];
  entity: string | null;
  entityId: string | null;
}

/** Thrown by a resolver when the send has nothing left to say; `send_email` ends the job `{ skipped: reason }`. */
export class SkipSend extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(`skipped:${reason}`);
    this.name = "SkipSend";
    this.reason = reason;
  }
}

/**
 * Thrown by a resolver that needs another job to finish first; `notify_admin` ends the job `retry_at` `at` without
 * using an attempt.
 */
export class WaitFor extends Error {
  readonly at: Date;
  readonly reason: string;

  constructor(at: Date, reason: string) {
    super(`waiting:${reason}`);
    this.name = "WaitFor";
    this.at = at;
    this.reason = reason;
  }
}

/** The job the variables are for: an alert that depends on a sibling job of its event reads it by `eventId`. */
export interface JobRun {
  eventId: string | null;
  now: Date;
}

const idField = {
  submission: "submission_id",
  payment: "payment_id",
  inquiry: "inquiry_id",
  subscriber: "subscriber_id",
  subject_request: "request_id",
} as const;

export type EntityKind = keyof typeof idField;

export const isEntityKind = (value: string): value is EntityKind => Object.hasOwn(idField, value);

/** The payload a row stands in for, so a preview or a test send reads the same row an event would name. */
export const entityData = (entity: EntityKind, id: string): JsonObject => ({
  [idField[entity]]: id,
});

// ---- reading -------------------------------------------------------------------------------------------------------

const text = (data: JsonObject, name: string): string | null => {
  const value = data[name];
  return typeof value === "string" && value !== "" ? value : null;
};

function need(data: JsonObject, name: string): string {
  const value = text(data, name);
  if (value === null) throw new NonRetryableError(`${name}_missing`);
  return value;
}

/** A table lookup by a value the database gave: an own entry only, so "constructor" finds nothing. */
function own<T>(table: Record<string, T>, key: string): T | undefined {
  return Object.hasOwn(table, key) ? table[key] : undefined;
}

function found<T>(row: T | undefined, what: string): T {
  if (row === undefined) throw new NonRetryableError(`${what}_missing`);
  return row;
}

function rowsOf<T>(result: { data: T[] | null; error: unknown }, table: string): T[] {
  if (result.error !== null || result.data === null) throw new Error(`email_read_failed:${table}`);
  return result.data;
}

const SUBMISSION =
  "id, submitter_name, submitter_email, address, city, state, package, decline_reason_id, decline_note";

async function submissionById(db: Db, id: string) {
  const result = await db.from("submissions").select(SUBMISSION).eq("id", id).limit(1);
  return rowsOf(result, "submissions")[0];
}

const needSubmission = async (db: Db, id: string) =>
  found(await submissionById(db, id), "submission");

async function inquiryById(db: Db, id: string) {
  const result = await db
    .from("inquiries")
    .select("name, email, phone, message, subject_slug, anonymised_at")
    .eq("id", id)
    .limit(1);
  return rowsOf(result, "inquiries")[0];
}

async function subjectRequestById(db: Db, id: string) {
  const result = await db
    .from("subject_requests")
    .select("email, kind, due_at")
    .eq("id", id)
    .limit(1);
  return rowsOf(result, "subject_requests")[0];
}

/** The inquiry, the property it is about and the submission that property was made from, as far as each exists. */
async function inquiryChain(db: Db, inquiryId: string) {
  const inquiry = await inquiryById(db, inquiryId);
  if (inquiry === undefined) return undefined;
  const slug = inquiry.subject_slug;
  const property =
    slug === null
      ? undefined
      : rowsOf(
          await db.from("properties").select("title, submission_id").eq("slug", slug).limit(1),
          "properties",
        )[0];
  const submissionId = property?.submission_id ?? null;
  const submission = submissionId === null ? undefined : await submissionById(db, submissionId);
  return { inquiry, title: property?.title ?? null, submission };
}

// ---- recipients ----------------------------------------------------------------------------------------------------

const defaultRecipient: Partial<Record<EmailTemplateKey, string>> = {
  received: "submitter",
  declined: "submitter",
  accepted: "submitter",
  awaiting_assets: "submitter",
  invoice: "submitter",
  inquiry_forward: "submitter",
  inquiry_ack: "inquirer",
  interest_confirm: "subscriber",
  newsletter_confirm: "subscriber",
  repermission: "subscriber",
  subject_ack: "requester",
  admin_notify: "admins",
  campaign_report: "submitter",
};

const recipientMissing = () => new NonRetryableError("recipient_missing");

async function submitterRecipient(db: Db, data: JsonObject): Promise<Recipient> {
  const submissionId = text(data, "submission_id");
  if (submissionId !== null) {
    const submission = await submissionById(db, submissionId);
    if (submission === undefined) throw recipientMissing();
    return { to: [submission.submitter_email], entity: "submission", entityId: submission.id };
  }
  const inquiryId = text(data, "inquiry_id");
  if (inquiryId === null) throw recipientMissing();
  // An inquiry with no property, or a property not made from a request, has no submitter to tell.
  const chain = await inquiryChain(db, inquiryId);
  if (chain === undefined) throw recipientMissing();
  const { submission } = chain;
  if (submission === undefined) return { to: [], entity: null, entityId: null };
  return { to: [submission.submitter_email], entity: "submission", entityId: submission.id };
}

/**
 * `params.to`, else the default of the key, decides; a job that no event made for a test goes to its actor alone. A
 * missing row or address is `recipient_missing`.
 */
export async function resolveRecipient(
  db: Db,
  key: EmailTemplateKey,
  params: { to?: string | undefined },
  data: JsonObject,
): Promise<Recipient> {
  if (data["test"] === true) {
    const actor = text(data, "actor_email");
    if (actor === null) throw recipientMissing();
    return { to: [actor], entity: text(data, "entity"), entityId: text(data, "entity_id") };
  }
  switch (params.to ?? defaultRecipient[key] ?? "") {
    case "submitter":
      return submitterRecipient(db, data);
    case "inquirer": {
      const id = need(data, "inquiry_id");
      const inquiry = await inquiryById(db, id);
      if (inquiry === undefined) throw recipientMissing();
      return { to: [inquiry.email], entity: "inquiry", entityId: id };
    }
    case "subscriber": {
      const id = need(data, "subscriber_id");
      const result = await db.from("subscribers").select("email").eq("id", id).limit(1);
      const subscriber = rowsOf(result, "subscribers")[0];
      if (subscriber === undefined) throw recipientMissing();
      return { to: [subscriber.email], entity: "subscriber", entityId: id };
    }
    case "requester": {
      const id = need(data, "request_id");
      const request = await subjectRequestById(db, id);
      if (request === undefined) throw recipientMissing();
      return { to: [request.email], entity: "subject_request", entityId: id };
    }
    case "admins":
      return { to: await resolveAdminRecipients(db), entity: null, entityId: null };
    default:
      throw recipientMissing();
  }
}

// ---- variables -----------------------------------------------------------------------------------------------------

interface Resolve {
  db: Db;
  data: JsonObject;
  eventType: string | undefined;
  headline: string | undefined;
  site: () => Promise<SiteContext>;
  job: JobRun | undefined;
}

export type Variables = Record<string, string>;

const facts = (submission: { submitter_name: string; address: string }): Variables => ({
  submitter_name: submission.submitter_name,
  property_address: submission.address,
});

/** A package the submitter has not chosen yet reads as a sentence, not as the label "Not sure yet". */
const packageName = (name: string): string =>
  name === "Not sure yet" ? "the product we agree together" : name;

async function submitted({ db, data }: Resolve): Promise<Variables> {
  const submission = await needSubmission(db, need(data, "submission_id"));
  return {
    ...facts(submission),
    city: submission.city,
    state: submission.state,
    package: packageName(submission.package),
  };
}

async function declined({ db, data }: Resolve): Promise<Variables> {
  const submission = await needSubmission(db, need(data, "submission_id"));
  const reasonId = text(data, "decline_reason_id") ?? submission.decline_reason_id;
  if (reasonId === null) throw new NonRetryableError("missing_variable:reason_label");
  const result = await db
    .from("decline_reasons")
    .select("label, email_paragraph")
    .eq("id", reasonId)
    .limit(1);
  const reason = found(rowsOf(result, "decline_reasons")[0], "decline_reason");
  return {
    ...facts(submission),
    reason_label: reason.label,
    reason_paragraph: reason.email_paragraph,
    note_paragraph: text(data, "note") ?? submission.decline_note ?? "",
  };
}

async function awaitingAssets({ db, data }: Resolve): Promise<Variables> {
  const submission = await needSubmission(db, need(data, "submission_id"));
  return { ...facts(submission), assets_note: text(data, "note") ?? "" };
}

// STUB(B6 step 8): terms, billing_email and the payment methods come from payments.invoice_snapshot, not settings.invoice
const invoiceSettings = z.object({
  terms: z.string(),
  billing_email: z.string(),
  payment_methods: z
    .array(z.object({ id: z.string(), label: z.string(), instructions: z.string() }))
    .default([]),
});

async function invoice({ db, data }: Resolve): Promise<Variables> {
  const paymentId = text(data, "payment_id");
  const submissionId = text(data, "submission_id");
  if (paymentId === null && submissionId === null)
    throw new NonRetryableError("payment_id_missing");
  const query = db
    .from("payments")
    .select("amount, invoice_number, product, preferred_method, submission_id");
  const result =
    paymentId !== null
      ? await query.eq("id", paymentId).limit(1)
      : await query
          .eq("submission_id", submissionId ?? "")
          .order("created_at", { ascending: false })
          .limit(1);
  const payment = found(rowsOf(result, "payments")[0], "payment");
  if (payment.invoice_number === null)
    throw new NonRetryableError("missing_variable:invoice_number");
  const submission = await needSubmission(db, payment.submission_id);
  const settings = invoiceSettings.safeParse((await readSettings(db, ["invoice"])).get("invoice"));
  if (!settings.success) throw new NonRetryableError("invoice_settings_missing");
  const { terms, billing_email, payment_methods } = settings.data;
  const chosen = payment_methods.find((method) => method.id === payment.preferred_method);
  const described = payment_methods.filter((method) => method.instructions !== "");
  return {
    ...facts(submission),
    invoice_number: payment.invoice_number,
    product: payment.product,
    amount: formatUsd(payment.amount),
    terms,
    preferred_method: chosen?.label ?? payment.preferred_method ?? "",
    payment_instructions:
      chosen !== undefined && chosen.instructions !== ""
        ? chosen.instructions
        : described.map((method) => `${method.label}: ${method.instructions}`).join("\n"),
    billing_email,
  };
}

async function inquiryAck({ db, data }: Resolve): Promise<Variables> {
  return { name: found(await inquiryById(db, need(data, "inquiry_id")), "inquiry").name };
}

async function inquiryForward({ db, data }: Resolve): Promise<Variables> {
  const chain = found(await inquiryChain(db, need(data, "inquiry_id")), "inquiry");
  const { inquiry, title, submission } = chain;
  if (inquiry.anonymised_at !== null) throw new SkipSend("anonymised");
  if (submission === undefined) throw new NonRetryableError("missing_variable:submitter_name");
  if (title === null) throw new NonRetryableError("missing_variable:property_title");
  return {
    submitter_name: submission.submitter_name,
    property_title: title,
    inquirer_name: inquiry.name,
    inquirer_contact: inquiry.phone === null ? inquiry.email : `${inquiry.email}, ${inquiry.phone}`,
    message: inquiry.message,
  };
}

const marketName: Record<string, string> = {
  california: "California",
  "new-york": "New York",
  florida: "Florida",
};

/** `California`, `California and Florida`, `California, New York and Florida`. */
function sentenceList(items: string[]): string {
  const last = items.at(-1) ?? "";
  return items.length < 2 ? last : `${items.slice(0, -1).join(", ")} and ${last}`;
}

/** The shape `env.ts` holds the Worker's key to: base64 of 32 bytes. */
const AES_KEY = /^[A-Za-z0-9+/]{43}=$/;

/**
 * The key is read at call time (G67 (8)); an unset or malformed key cannot open any token, so retrying is futile. A
 * token sealed with another key, or changed, cannot be opened.
 */
async function openSealedToken(sealed: string): Promise<string> {
  const key = readVar("CONFIRM_TOKEN_SECRET");
  if (key === undefined || !AES_KEY.test(key))
    throw new NonRetryableError("confirm_secret_missing");
  const token = await openToken(sealed, key);
  if (token === null) throw new NonRetryableError("token_unreadable");
  return token;
}

/** The confirmation link: the raw token opened from the sealed one the event carried (invariant 7), on the site. */
async function confirmUrl({ data, site }: Resolve): Promise<string> {
  const sealed = text(data, "sealed_token");
  if (sealed === null) throw new NonRetryableError("missing_variable:confirm_url");
  const token = await openSealedToken(sealed);
  return `${(await site()).siteUrl}/api/public/subscribers/confirm?token=${encodeURIComponent(token)}`;
}

/**
 * The confirmation a subscriber is sent, whichever of the two keys the job names (invariant 7, DL-06): the interest one
 * while they follow markets and ask for nothing more, the Place Notes one when they follow none or ask for it now.
 */
export async function confirmTemplateKey(
  db: Db,
  data: JsonObject,
): Promise<"interest_confirm" | "newsletter_confirm"> {
  const id = need(data, "subscriber_id");
  const result = await db
    .from("subscribers")
    .select("markets, pending_source")
    .eq("id", id)
    .limit(1);
  const subscriber = found(rowsOf(result, "subscribers")[0], "subscriber");
  return subscriber.markets.length > 0 && subscriber.pending_source === null
    ? "interest_confirm"
    : "newsletter_confirm";
}

async function interestConfirm(resolve: Resolve): Promise<Variables> {
  const id = need(resolve.data, "subscriber_id");
  const result = await resolve.db.from("subscribers").select("markets").eq("id", id).limit(1);
  const { markets } = found(rowsOf(result, "subscribers")[0], "subscriber");
  const names = markets.flatMap((slug) => own(marketName, slug) ?? []);
  if (names.length === 0) throw new NonRetryableError("missing_variable:market_names");
  return { market_names: sentenceList(names), confirm_url: await confirmUrl(resolve) };
}

async function confirmOnly(resolve: Resolve): Promise<Variables> {
  return { confirm_url: await confirmUrl(resolve) };
}

const kindLabel: Record<string, string> = {
  access: "access",
  deletion: "deletion",
  opt_out: "opt-out",
  correction: "correction",
};

async function subjectRequestFacts(db: Db, data: JsonObject) {
  const request = found(await subjectRequestById(db, need(data, "request_id")), "subject_request");
  const label = own(kindLabel, request.kind);
  if (label === undefined) throw new NonRetryableError("missing_variable:kind_label");
  if (request.due_at === null) throw new NonRetryableError("missing_variable:due_date");
  return { kind_label: label, due_date: formatDate(request.due_at) };
}

const subjectAck = ({ db, data }: Resolve): Promise<Variables> => subjectRequestFacts(db, data);

// ---- admin_notify --------------------------------------------------------------------------------------------------

interface Alert {
  headline: string;
  path: (data: JsonObject) => string;
  summary: (resolve: Resolve) => Promise<string>;
}

async function paymentSummary({ db, data }: Resolve): Promise<string> {
  const result = await db
    .from("payments")
    .select("invoice_number, amount, status")
    .eq("id", need(data, "payment_id"))
    .limit(1);
  const payment = found(rowsOf(result, "payments")[0], "payment");
  return `${payment.invoice_number ?? "Payment"}, ${formatUsd(payment.amount)} (${payment.status})`;
}

const failedChecks = z.array(z.object({ check: z.string(), message: z.string() }));

const alerts: Record<string, Alert> = {
  "submission.received": {
    headline: "New request",
    path: (data) => `/admin/requests/${need(data, "submission_id")}`,
    summary: async ({ db, data }) => {
      const s = await needSubmission(db, need(data, "submission_id"));
      return `New request: ${s.address}, ${s.city}, ${s.state}`;
    },
  },
  "payment.marked": {
    headline: "Payment marked",
    path: (data) => `/admin/invoices/${need(data, "payment_id")}`,
    summary: paymentSummary,
  },
  "invoice.voided": {
    headline: "Invoice voided",
    path: (data) => `/admin/invoices/${need(data, "payment_id")}`,
    summary: paymentSummary,
  },
  "inquiry.received": {
    headline: "New inquiry",
    path: (data) => `/admin/inquiries?id=${need(data, "inquiry_id")}`,
    summary: async ({ db, data }) => {
      const inquiry = found(await inquiryById(db, need(data, "inquiry_id")), "inquiry");
      return `${inquiry.name}, ${inquiry.email}`;
    },
  },
  "health.failed": {
    headline: "Health check failed",
    path: () => "/admin/jobs",
    summary: ({ data }) => {
      const parsed = failedChecks.safeParse(data["failed"]);
      if (!parsed.success) throw new NonRetryableError("failed_checks_malformed");
      const failed = parsed.data;
      const noun = failed.length === 1 ? "health check" : "health checks";
      const lines = failed.map((item) => `${item.check}: ${item.message}`).join("; ");
      return Promise.resolve(`${String(failed.length)} ${noun} failed: ${lines}`);
    },
  },
  "subject_request.received": {
    headline: "Privacy request received",
    path: () => "/admin/audit",
    summary: async ({ db, data }) => {
      const { kind_label, due_date } = await subjectRequestFacts(db, data);
      return `${kind_label} request received, due ${due_date}`;
    },
  },
};

const notice = (headline: string, summary: string, path: string): Alert => ({
  headline,
  path: () => path,
  summary: () => Promise.resolve(summary),
});

const digestResult = z.union([
  z.object({ issue_id: z.null() }),
  z.object({ issue_id: z.string(), number: z.number().int() }),
]);

const DIGEST_WAIT_MS = 60 * 1000;

/** The `digest.due` notice says what the `queue_digest` job of the same event found, and waits while it has not ended. */
async function digestAlert({ db, job }: Resolve): Promise<Alert> {
  if (job === undefined || job.eventId === null) throw new NonRetryableError("event_id_missing");
  const rows = rowsOf(
    await db
      .from("jobs")
      .select("status, result")
      .eq("event_id", job.eventId)
      .eq("type", "queue_digest")
      .limit(1),
    "jobs",
  );
  const sibling = found(rows[0], "queue_digest_job");
  if (sibling.status === "dead" || sibling.status === "cancelled") {
    return notice(
      "Place Notes draft could not be built",
      "The digest job ended without a draft. Its job record says why.",
      `/admin/jobs?event_id=${job.eventId}`,
    );
  }
  if (sibling.status !== "done") {
    throw new WaitFor(new Date(job.now.getTime() + DIGEST_WAIT_MS), "waiting_queue_digest");
  }
  const result = digestResult.safeParse(sibling.result);
  if (!result.success) throw new NonRetryableError("queue_digest_result_malformed");
  if (result.data.issue_id === null) {
    return notice(
      "Nothing to send this cycle",
      "Nothing was published or approved since the last issue, so no draft was made.",
      "/admin/newsletter",
    );
  }
  return notice(
    `Place Notes No. ${String(result.data.number)} draft ready for review`,
    "Open the draft to check the blocks, the subject and the preheader before approving it.",
    `/admin/newsletter/${result.data.issue_id}`,
  );
}

/** Alerts whose words depend on what another job found, so they are settled before they are read like the others. */
const settled: Record<string, (resolve: Resolve) => Promise<Alert>> = {
  "digest.due": digestAlert,
};

async function adminNotify(resolve: Resolve): Promise<Variables> {
  const { data, eventType, headline: given, site } = resolve;
  const settle = eventType === undefined ? undefined : own(settled, eventType);
  const alert =
    settle !== undefined
      ? await settle(resolve)
      : eventType === undefined
        ? undefined
        : own(alerts, eventType);
  const supplied = text(data, "summary");
  if (supplied === null && alert === undefined) {
    throw new NonRetryableError("missing_variable:summary");
  }
  const summary = supplied ?? (await alert?.summary(resolve)) ?? "";
  const path = text(data, "link_path") ?? alert?.path(data) ?? "";
  if (path !== "" && !/^\/(?!\/)/.test(path)) throw new NonRetryableError("link_path_invalid");
  const link_url = path === "" ? "" : `${(await site()).siteUrl}${path}`;
  const headline = given ?? alert?.headline;
  if (headline === undefined) throw new NonRetryableError("missing_variable:headline");
  return { headline: interpolate(headline, { summary, link_url }), summary, link_url };
}

const NOT_MEASURED = "Not measured";

/** A weekly report: the property, the week and the figures, each as the page shows it (G22). */
async function campaignReport({ db, data }: Resolve): Promise<Variables> {
  const result = await db
    .from("campaign_reports")
    .select(
      "period_start, period_end, impressions, reach, clicks, video_views, ctr, campaigns!inner(properties!inner(title))",
    )
    .eq("id", need(data, "report_id"))
    .limit(1);
  const report = found(rowsOf(result, "campaign_reports")[0], "report");
  return {
    property_name: report.campaigns.properties.title,
    period: `${formatDate(report.period_start)} to ${formatDate(report.period_end)}`,
    impressions: formatCount(report.impressions),
    reach: formatCount(report.reach),
    clicks: formatCount(report.clicks),
    video_views: report.video_views === null ? NOT_MEASURED : formatCount(report.video_views),
    ctr: report.ctr === null ? NOT_MEASURED : formatPercent(report.ctr),
  };
}

const resolvers: Record<EmailTemplateKey, (resolve: Resolve) => Promise<Variables>> = {
  received: submitted,
  accepted: submitted,
  declined,
  awaiting_assets: awaitingAssets,
  invoice,
  inquiry_ack: inquiryAck,
  inquiry_forward: inquiryForward,
  interest_confirm: interestConfirm,
  newsletter_confirm: confirmOnly,
  repermission: confirmOnly,
  admin_notify: adminNotify,
  standalone: () => Promise.resolve({}),
  // B11 invariant 14: the market_open_notice job passes both variables to renderTemplate itself.
  market_open: () => Promise.resolve({}),
  subject_ack: subjectAck,
  campaign_report: campaignReport,
};

/**
 * The variables of `key` for the event payload `data`: one resolver per key, each returning a string for every name in
 * `variablesByKey[key]`. `site` is read only by a resolver that builds a link, and is loaded from the settings and
 * `SITE_URL` when not given (the job runner). `headline` is the `notify_admin` step's `params.headline`.
 * `job` is read by an alert that waits for a sibling job (`digest.due`).
 */
export function resolveVariables(
  db: Db,
  key: EmailTemplateKey,
  data: JsonObject,
  eventType?: string,
  site?: SiteContext,
  headline?: string,
  job?: JobRun,
): Promise<Variables> {
  return resolvers[key]({
    db,
    data,
    eventType,
    headline,
    job,
    site: () => (site === undefined ? loadSiteContext(db) : Promise.resolve(site)),
  });
}
