import { z } from "zod";
import { siteConfig } from "../../config/site.ts";
import type { NewsletterBlock } from "../../domain/newsletter.ts";
import { loadSiteContext } from "../email/context.ts";
import { fromRpcError } from "../lib/admin-errors.ts";
import type { AdminActor } from "../lib/admin-route.ts";
import { auditContext } from "../lib/audit.ts";
import { authorize } from "../lib/authz.ts";
import type { Db } from "../lib/db.ts";
import { AppError } from "../lib/errors.ts";
import { enqueueJob } from "../lib/jobs.ts";
import { collectCandidates, mergeDraft, readIssues } from "./assemble.ts";
import { subscriberCounts, type SubscriberCounts } from "./audience.ts";
import { loadBlocks, readIssue } from "./issue.ts";
import { renderPreview } from "./render.ts";

// Screen 13 (B11 Files). Each function is reached only through its `defineAdminRoute` handler, starts with
// `authorize`, and makes one RPC of Data changes or a read. Nothing here calls Resend: a send test is a
// `newsletter_preview` job the job runner sends.

const ISSUE_COLUMNS =
  "id, number, status, blocks, subject, preheader, scheduled_for, sent_at, send_error, approval_count, metrics";

/** The columns of the subscriber export, in order; `newsletter_export_subscribers` returns them by these names. */
const subscriberCsvColumns = [
  "email",
  "markets",
  "source",
  "status",
  "confirmed_at",
  "unsubscribed_at",
] as const;

const savedIssue = z.object({ id: z.string(), number: z.number().int() });

const notFound = () => new AppError("not_found", undefined, "There is no such issue.");

/** Every issue, newest first. */
export async function listIssues(actor: AdminActor, db: Db) {
  authorize(actor, "newsletter.issues_list");
  const { data, error } = await db
    .from("newsletter_issues")
    .select(ISSUE_COLUMNS)
    .order("number", { ascending: false });
  if (error !== null) throw fromRpcError(error);
  return data;
}

export async function getIssue(actor: AdminActor, db: Db, input: { id: string }) {
  authorize(actor, "newsletter.issues_get");
  const { data, error } = await db
    .from("newsletter_issues")
    .select(ISSUE_COLUMNS)
    .eq("id", input.id)
    .limit(1);
  if (error !== null) throw fromRpcError(error);
  const [issue] = data;
  if (issue === undefined) throw notFound();
  return issue;
}

/** Builds the open draft now from what was published since the last issue, as the fortnightly run would. */
export async function buildIssue(
  actor: AdminActor,
  db: Db,
): Promise<{ id: string; number: number }> {
  authorize(actor, "newsletter.build");
  const all = await readIssues(db);
  const draft = all.find(({ status }) => status === "draft");
  const merged = mergeDraft(
    draft ?? {
      number: Math.max(0, ...all.map(({ number }) => number)) + 1,
      blocks: [],
      subject: null,
      preheader: null,
    },
    await collectCandidates(db, all),
  );
  if (merged.blocks.length === 0) {
    throw new AppError(
      "issue_empty",
      undefined,
      "Nothing has been published since the last issue.",
    );
  }
  const { data, error } = await db.rpc("newsletter_save_draft", {
    p_blocks: merged.blocks,
    p_subject: merged.subject,
    p_preheader: merged.preheader,
    ...auditContext(actor),
  });
  if (error !== null) throw fromRpcError(error);
  return savedIssue.parse(data);
}

export async function updateIssue(
  actor: AdminActor,
  db: Db,
  input: { id: string; blocks: NewsletterBlock[]; subject: string; preheader: string },
) {
  authorize(actor, "newsletter.update");
  const { data, error } = await db.rpc("newsletter_update_issue", {
    p_issue: input.id,
    p_blocks: input.blocks,
    p_subject: input.subject,
    p_preheader: input.preheader,
    ...auditContext(actor),
  });
  if (error !== null) throw fromRpcError(error);
  return data;
}

/** The issue as a subscriber will get it, at the width of the preview frame. */
export async function previewIssue(
  actor: AdminActor,
  db: Db,
  input: { id: string; viewport: "desktop" | "phone" },
): Promise<{ html: string; width: number }> {
  authorize(actor, "newsletter.preview");
  const issue = await readIssue(db, input.id);
  if (issue === null) throw notFound();
  const site = await loadSiteContext(db, siteConfig.url);
  return renderPreview((await loadBlocks(db, issue)).render, input.viewport, site);
}

/**
 * Queues one test send of the issue to `to`, the address of the person who asked (the route reads it; `AdminActor`
 * carries none). The key holds the minute, so a double click makes one job; the job id, or null for a repeat.
 */
export async function sendTest(
  actor: AdminActor,
  db: Db,
  input: { id: string; to: string },
): Promise<{ job_id: string | null }> {
  authorize(actor, "newsletter.send_test");
  const minute = new Date().toISOString().slice(0, 16);
  const jobId = await enqueueJob(db, {
    type: "newsletter_preview",
    idempotencyKey: `newsletter_preview:${input.id}:test:${actor.userId}:${minute}`,
    data: { issue_id: input.id, test: true, to: input.to },
    maxAttempts: 12,
  });
  return { job_id: jobId };
}

export async function approveIssue(
  actor: AdminActor,
  db: Db,
  input: { id: string; send_at?: string | undefined },
) {
  authorize(actor, "newsletter.approve");
  const { data, error } = await db.rpc("newsletter_approve_issue", {
    p_issue: input.id,
    p_send_at: input.send_at ?? new Date().toISOString(),
    ...auditContext(actor),
  });
  if (error !== null) throw fromRpcError(error);
  return data;
}

export async function unapproveIssue(actor: AdminActor, db: Db, input: { id: string }) {
  authorize(actor, "newsletter.unapprove");
  const { data, error } = await db.rpc("newsletter_unapprove_issue", {
    p_issue: input.id,
    ...auditContext(actor),
  });
  if (error !== null) throw fromRpcError(error);
  return data;
}

/** How many subscribers are in each state and audience; never an address. */
export async function listSubscribers(actor: AdminActor, db: Db): Promise<SubscriberCounts> {
  authorize(actor, "newsletter.subscribers_count");
  return subscriberCounts(db);
}

/** A spreadsheet cell: quoted when it holds a separator, and never read as a formula. */
function cell(value: string | null): string {
  const text = value ?? "";
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

/** Every subscriber as CSV, one audit row with the count (G27). */
export async function exportSubscribers(actor: AdminActor, db: Db): Promise<string> {
  authorize(actor, "newsletter.subscribers_export");
  const { data, error } = await db.rpc("newsletter_export_subscribers", auditContext(actor));
  if (error !== null) throw fromRpcError(error);
  const lines = data.map((row) =>
    subscriberCsvColumns.map((column) => cell(row[column])).join(","),
  );
  return `${[subscriberCsvColumns.join(","), ...lines].join("\r\n")}\r\n`;
}
