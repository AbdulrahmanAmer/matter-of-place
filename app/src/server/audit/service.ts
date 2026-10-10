import { z } from "zod";
import { auditListInputSchema, auditRetentionRowSchema } from "../../domain/admin-audit.ts";
import { collectWeeklyKpis } from "../kpi/collect.ts";
import { lastFullWeekStart } from "../kpi/definitions.ts";
import type { AdminActor } from "../lib/admin-route.ts";
import { auditContext, listAudit } from "../lib/audit.ts";
import { authorize } from "../lib/authz.ts";
import { fromRpcError } from "../lib/admin-errors.ts";
import type { Db } from "../lib/db.ts";
import { fromZod } from "../lib/errors.ts";

// Screen 25 (B7 step 15): the audit log. Reads only; B14 appends its own reads to this file.

/** `GET /api/admin/audit`: one page of the audit log under the filters, newest first. */
export async function listAuditLog(actor: AdminActor, db: Db, filters: unknown) {
  authorize(actor, "audit.list");
  const parsed = auditListInputSchema.safeParse(filters);
  if (!parsed.success) throw fromZod(parsed.error);
  return listAudit(db, parsed.data);
}

// Step 15a: the data requests live in `subject-requests.ts`; route files import services from this file only.
export {
  deleteSubject,
  exportSubject,
  listSubjectRequests,
  optOutSubject,
  setSubjectRequestStatus,
} from "./subject-requests.ts";

// B14 step 4: the weekly audit routine's endpoints. Reads write no audit row (B7); the one write audits inside SQL.

/** A retention policy with no run for this long is stalled (B8 GD-03). */
const STALE_RUN_MS = 2 * 24 * 60 * 60 * 1000;
/** Rule 9: an admin list answers at most 50 rows. */
const NOT_FOUND_LIMIT = 50;

async function call<T>(request: PromiseLike<{ data: T; error: unknown }>): Promise<T> {
  const { data, error } = await request;
  if (error !== null) throw fromRpcError(error);
  return data;
}

/** The raw `audit_usage()` numbers, with no actor. */
const readUsage = (db: Db) => call(db.rpc("audit_usage"));

/** `GET /api/admin/audit/usage`: the free-tier numbers our own database measures (invariant 4). */
export async function getUsage(actor: AdminActor, db: Db) {
  authorize(actor, "audit.usage");
  return readUsage(db);
}

const healthSchema = z.object({ retention: z.array(auditRetentionRowSchema) }).passthrough();

/**
 * `GET /api/admin/audit/health`: `audit_health()` plus `retention_stalled`, each policy whose overdue count is not
 * zero or whose last run is missing or older than 2 days (a finding of the report, B8 GD-03).
 */
export async function getHealth(actor: AdminActor, db: Db, now = new Date()) {
  authorize(actor, "audit.health");
  const health = healthSchema.parse(await call(db.rpc("audit_health")));
  const retentionStalled = health.retention
    .filter(
      (row) =>
        (row.overdue ?? 0) > 0 ||
        row.last_run_at === null ||
        now.getTime() - Date.parse(row.last_run_at) > STALE_RUN_MS,
    )
    .map(({ key, overdue, last_run_at }) => ({ key, overdue, last_run_at }));
  return { ...health, retention_stalled: retentionStalled };
}

/** `GET /api/admin/audit/notfound`: the paths that answered 404 in the window, most asked first (GG-02). */
export async function listNotFound(actor: AdminActor, db: Db, days: number) {
  authorize(actor, "audit.notfound");
  const items = await call(db.rpc("audit_not_found", { p_days: days, p_limit: NOT_FOUND_LIMIT }));
  return { items };
}

/** `GET /api/admin/audit/kpis`: B11's weekly numbers as `collectWeeklyKpis` returns them; none is computed here. */
export async function getKpis(
  actor: AdminActor,
  db: Db,
  weekStart: string | undefined,
  now = new Date(),
) {
  authorize(actor, "audit.kpis");
  return collectWeeklyKpis(db, weekStart ?? lastFullWeekStart(now));
}

/** `POST /api/admin/audit/record-run`: `last_run_at` of the audit schedule row, audited inside the function (G9). */
export async function recordAuditRun(actor: AdminActor, db: Db) {
  authorize(actor, "audit.record_run");
  const lastRunAt = await call(db.rpc("audit_record_run", auditContext(actor)));
  return { last_run_at: lastRunAt };
}
