import { z } from "zod";
import {
  reportPageSize,
  reportSchema,
  type Report,
  type ReportFilters,
} from "../../domain/admin-reports.ts";
import { fromRpcError } from "../lib/admin-errors.ts";
import { adminJson } from "../lib/admin-response.ts";
import type { AdminActor } from "../lib/admin-route.ts";
import { auditContext } from "../lib/audit.ts";
import { authorize } from "../lib/authz.ts";
import type { Db } from "../lib/db.ts";
import { AppError } from "../lib/errors.ts";

// Screen 22 (B10 Files, `reports/service.ts`, G22). Each function authorizes before it touches the database. Nothing
// here calls a platform or builds a report: the reconcile job does (invariant 1), and the email is one RPC that
// enqueues the `send_email` job.

const REPORT_COLUMNS = "*, campaigns!inner(property_id, properties!inner(title))";

const joined = reportSchema
  .omit({ property_name: true })
  .extend({
    campaigns: z.object({ properties: z.object({ title: z.string() }) }),
  })
  .transform(({ campaigns, ...report }): Report => ({
    ...report,
    property_name: campaigns.properties.title,
  }));

/** `GET /api/admin/reports`: one page of 50, newest week first, for every campaign or the one asked for. */
export async function listReports(
  actor: AdminActor,
  db: Db,
  input: ReportFilters,
): Promise<{ items: Report[]; total: number }> {
  authorize(actor, "reports.list");
  let query = db.from("campaign_reports").select(REPORT_COLUMNS, { count: "exact" });
  if (input.campaign_id !== undefined) query = query.eq("campaign_id", input.campaign_id);
  const from = (input.page - 1) * reportPageSize;
  const { data, error, count } = await query
    .order("period_start", { ascending: false })
    .range(from, from + reportPageSize - 1);
  if (error !== null) throw fromRpcError(error);
  return { items: z.array(joined).parse(data), total: count ?? 0 };
}

/** `GET /api/admin/reports/:id`. */
export async function getReport(actor: AdminActor, db: Db, input: { id: string }): Promise<Report> {
  authorize(actor, "reports.get");
  const { data, error } = await db
    .from("campaign_reports")
    .select(REPORT_COLUMNS)
    .eq("id", input.id)
    .limit(1);
  if (error !== null) throw fromRpcError(error);
  const row = data[0];
  if (row === undefined) throw new AppError("not_found", undefined, "This report does not exist.");
  return joined.parse(row);
}

/**
 * `POST /api/admin/reports/:id/email` (G22): the report goes to the person who submitted the property. One RPC
 * enqueues the `send_email` job and writes the `reports.email` audit row; a second click inside the same minute
 * makes no second job and answers `duplicate`. The RPC raises `recipient_missing` (422) for a campaign with no
 * submission and `not_found` (404) for a report that does not exist. Answers 202.
 */
export async function emailReport(
  actor: AdminActor,
  db: Db,
  input: { id: string },
): Promise<Response> {
  authorize(actor, "reports.email");
  const { data, error } = await db.rpc("email_campaign_report", {
    p_report_id: input.id,
    ...auditContext(actor),
  });
  if (error !== null) throw fromRpcError(error);
  // The function answers null when a job for this minute already exists; the generated type does not say so.
  const jobId = z.string().nullable().parse(data);
  return adminJson(jobId === null ? { job_id: null, duplicate: true } : { job_id: jobId }, {
    status: 202,
  });
}
