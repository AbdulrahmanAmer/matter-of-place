import type { Enums } from "../../db/index.ts";
import type { JobListInput, JobRetryBulkInput } from "../../domain/jobs.ts";
import { fromRpcError } from "../lib/admin-errors.ts";
import type { AdminActor } from "../lib/admin-route.ts";
import { auditContext } from "../lib/audit.ts";
import { authorize } from "../lib/authz.ts";
import type { Db } from "../lib/db.ts";
import { AppError } from "../lib/errors.ts";
import { entityJobsFilter } from "../lib/jobs.ts";

// Screen 16 (B8 step 9). Reads are selects on `jobs`; each action is one RPC that changes the job, writes its
// `job_events` row and its audit row in one transaction. Nothing outside the database is called (invariant 7).

const JOB_COLUMNS =
  "id, type, status, attempts, max_attempts, run_after, run_local, heavy, payload, result, error, event_id, recipe_id, step_id, idempotency_key, created_at, updated_at, finished_at";

const EVENT_COLUMNS = "id, at, kind, from_status, to_status, attempt, message, data, actor_id";

/** A page starts after the row it names: its `created_at` exactly as listed, then its id. */
const CURSOR = /^(\d{4}-\d\d-\d\dT[\d:.]+(?:Z|[+-]\d\d:\d\d))~([0-9a-f-]{36})$/;

/** `%`, `_` and `\` in the searched text match only themselves. */
const literalLike = (text: string): string => text.replace(/[\\%_]/g, "\\$&");

function filtered(db: Db, input: JobListInput) {
  let query = db.from("jobs").select(JOB_COLUMNS);
  if (input.status !== undefined) query = query.eq("status", input.status);
  if (input.dead_only === true) query = query.eq("status", "dead");
  if (input.type !== undefined) query = query.eq("type", input.type);
  if (input.event_id !== undefined) query = query.eq("event_id", input.event_id);
  if (input.entity !== undefined) query = query.or(entityJobsFilter(input.entity));
  if (input.q !== undefined) query = query.ilike("error", `%${literalLike(input.q)}%`);
  return query;
}

type JobQuery = ReturnType<typeof filtered>;

async function newestFirst(query: JobQuery, take: number) {
  const { data, error } = await query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(take);
  if (error !== null) throw fromRpcError(error);
  return data;
}

/** The rows after the cursor's `(created_at, id)` with AND filters only (R44): its ties first, then older rows. */
async function after(db: Db, input: JobListInput, cursor: string, take: number) {
  const [, at, id] = CURSOR.exec(cursor) ?? [];
  if (at === undefined || id === undefined) {
    throw new AppError("validation", undefined, "This page link is no longer valid.");
  }
  const ties = await newestFirst(filtered(db, input).eq("created_at", at).lt("id", id), take);
  if (ties.length >= take) return ties;
  return [...ties, ...(await newestFirst(filtered(db, input).lt("created_at", at), take))];
}

type JobRow = Awaited<ReturnType<typeof newestFirst>>[number];

interface JobPage {
  items: JobRow[];
  next_cursor: string | null;
}

/** The first `limit` of `limit + 1` rows; the extra row only says that a next page exists. */
function pageOf(rows: JobRow[], limit: number): JobPage {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  if (rows.length <= limit || last === undefined) return { items, next_cursor: null };
  return { items, next_cursor: `${last.created_at}~${last.id}` };
}

/** `GET /api/admin/jobs`: newest first, one keyset page (B7 invariant 17c). */
export async function listJobs(actor: AdminActor, db: Db, input: JobListInput): Promise<JobPage> {
  authorize(actor, "jobs.list");
  const take = input.limit + 1;
  if (input.cursor === undefined)
    return pageOf(await newestFirst(filtered(db, input), take), input.limit);
  return pageOf(await after(db, input, input.cursor, take), input.limit);
}

/** `GET /api/admin/jobs/:id`: the job and its transitions, oldest first. */
export async function getJob(actor: AdminActor, db: Db, input: { id: string }) {
  authorize(actor, "jobs.get");
  const job = await db.from("jobs").select(JOB_COLUMNS).eq("id", input.id);
  if (job.error !== null) throw fromRpcError(job.error);
  const row = job.data[0];
  if (row === undefined) throw new AppError("not_found", undefined, "This job does not exist.");
  const events = await db
    .from("job_events")
    .select(EVENT_COLUMNS)
    .eq("job_id", input.id)
    .order("id", { ascending: true });
  if (events.error !== null) throw fromRpcError(events.error);
  return { ...row, events: events.data };
}

type JobAction = "admin_retry_job" | "admin_cancel_job" | "admin_approve_job";

interface JobAnswer {
  id: string;
  status: Enums<"job_status">;
}

async function act(
  actor: AdminActor,
  db: Db,
  fn: JobAction,
  id: string,
  status: JobAnswer["status"],
): Promise<JobAnswer> {
  const { error } = await db.rpc(fn, { p_job_id: id, ...auditContext(actor) });
  if (error !== null) throw fromRpcError(error);
  return { id, status };
}

/** `POST /api/admin/jobs/:id/retry`: a dead or failed job is queued again from attempt 0. */
export async function retryJob(
  actor: AdminActor,
  db: Db,
  input: { id: string },
): Promise<JobAnswer> {
  authorize(actor, "jobs.retry");
  return act(actor, db, "admin_retry_job", input.id, "queued");
}

/** `POST /api/admin/jobs/:id/cancel`: a queued, failed or waiting job is cancelled. */
export async function cancelJob(
  actor: AdminActor,
  db: Db,
  input: { id: string },
): Promise<JobAnswer> {
  authorize(actor, "jobs.cancel");
  return act(actor, db, "admin_cancel_job", input.id, "cancelled");
}

/** `POST /api/admin/jobs/:id/approve`: a job waiting for approval is queued; a person only (S23, S46). */
export async function approveJob(
  actor: AdminActor,
  db: Db,
  input: { id: string },
): Promise<JobAnswer> {
  authorize(actor, "jobs.approve");
  return act(actor, db, "admin_approve_job", input.id, "queued");
}

/** `POST /api/admin/jobs/retry-bulk` (E2E-03): every dead job that matches each filter given; answers how many. */
export async function retryBulkJobs(
  actor: AdminActor,
  db: Db,
  input: JobRetryBulkInput,
): Promise<{ count: number }> {
  authorize(actor, "jobs.retry_bulk");
  const { data, error } = await db.rpc("admin_retry_jobs", {
    ...auditContext(actor),
    ...(input.type === undefined ? {} : { p_type: input.type }),
    ...(input.error_like === undefined ? {} : { p_error_like: input.error_like }),
    ...(input.since === undefined ? {} : { p_since: input.since }),
  });
  if (error !== null) throw fromRpcError(error);
  return { count: data };
}
