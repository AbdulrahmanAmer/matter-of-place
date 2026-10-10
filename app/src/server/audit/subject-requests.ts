import {
  subjectExportSchema,
  subjectFulfilledSchema,
  subjectRequestRowSchema,
  subjectStatusAnswer,
  type SubjectRequestRow,
  type SubjectStatusAction,
} from "../../domain/admin-audit.ts";
import { fromRpcError } from "../lib/admin-errors.ts";
import type { AdminActor } from "../lib/actor-types.ts";
import { auditContext } from "../lib/audit.ts";
import { authorize } from "../lib/authz.ts";
import type { Db } from "../lib/db.ts";
import { AppError } from "../lib/errors.ts";

// Screen 25's second tab (B7 step 15a, invariant 15): the data requests of B3's `subject_requests` and the four
// writes on them. Every write action carries `recentAuth` in the matrix, so `defineAdminRoute` enforces the 15
// minutes and no function here calls `requireRecentAuth` (API-02). Each write is one SQL function that locks the
// request, checks its kind, state and confirmed identity, and audits with ids and counts only.

const DAY_MS = 86_400_000;
const storedRow = subjectRequestRowSchema.omit({ days_left: true });
const COLUMNS =
  "id, email, kind, note, status, received_at, due_at, verified_at, fulfilled_at, handled_by";
/** A page starts after the row it names: its `received_at` exactly as listed, then its id. */
const CURSOR = /^(\d{4}-\d\d-\d\dT[\d:.]+(?:Z|[+-]\d\d:\d\d))~([0-9a-f-]{36})$/;

const requests = (db: Db) => db.from("subject_requests").select(COLUMNS);

type RequestQuery = ReturnType<typeof requests>;

async function newestFirst(query: RequestQuery, take: number) {
  const { data, error } = await query
    .order("received_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(take);
  if (error !== null) throw fromRpcError(error);
  return data;
}

/**
 * `GET audit/subject-requests`: one keyset page, newest first, on B3's `received_at desc` index, each row with the
 * whole days left of its 45 day clock at `now`.
 */
export async function listSubjectRequests(
  actor: AdminActor,
  db: Db,
  input: { limit: number; cursor?: string | undefined },
  now: Date = new Date(),
): Promise<{ items: SubjectRequestRow[]; next_cursor: string | null }> {
  authorize(actor, "audit.subject_requests");
  const take = input.limit + 1;
  let rows: Awaited<ReturnType<typeof newestFirst>>;
  if (input.cursor === undefined) rows = await newestFirst(requests(db), take);
  else {
    const [, at, id] = CURSOR.exec(input.cursor) ?? [];
    if (at === undefined || id === undefined) {
      throw new AppError("validation", undefined, "This page link is no longer valid.");
    }
    const ties = await newestFirst(requests(db).eq("received_at", at).lt("id", id), take);
    rows =
      ties.length >= take
        ? ties
        : [...ties, ...(await newestFirst(requests(db).lt("received_at", at), take - ties.length))];
  }
  const items = rows.slice(0, input.limit).map((row) => {
    const stored = storedRow.parse(row);
    return {
      ...stored,
      days_left: Math.ceil((Date.parse(stored.due_at) - now.getTime()) / DAY_MS),
    };
  });
  const last = rows.length > input.limit ? items.at(-1) : undefined;
  return { items, next_cursor: last === undefined ? null : `${last.received_at}~${last.id}` };
}

/** `POST audit/subject-requests/:id/status`: start verification, confirm identity, reject, or close a correction. */
export async function setSubjectRequestStatus(
  actor: AdminActor,
  db: Db,
  input: { id: string; action: SubjectStatusAction; note?: string | undefined },
) {
  authorize(actor, "audit.subject_status");
  const { data, error } = await db.rpc("set_subject_request_status", {
    p_subject_request_id: input.id,
    p_action: input.action,
    ...auditContext(actor),
    ...(input.note === undefined ? {} : { p_note: input.note }),
  });
  if (error !== null) throw fromRpcError(error);
  return subjectStatusAnswer.parse(data);
}

/** `POST audit/subject-requests/:id/export`: the bundle of an access request; the request is then fulfilled. */
export async function exportSubject(actor: AdminActor, db: Db, input: { id: string }) {
  authorize(actor, "audit.subject_export");
  const { data, error } = await db.rpc("export_subject", {
    p_subject_request_id: input.id,
    ...auditContext(actor),
  });
  if (error !== null) throw fromRpcError(error);
  return subjectExportSchema.parse(data);
}

/** `POST audit/subject-requests/:id/delete`: anonymises every row of the address (GD-04: nothing is hard deleted). */
export async function deleteSubject(actor: AdminActor, db: Db, input: { id: string }) {
  authorize(actor, "audit.subject_delete");
  const { data, error } = await db.rpc("delete_subject", {
    p_subject_request_id: input.id,
    ...auditContext(actor),
  });
  if (error !== null) throw fromRpcError(error);
  return subjectFulfilledSchema.parse(data);
}

/** `POST audit/subject-requests/:id/opt-out`: unsubscribes and suppresses the address. */
export async function optOutSubject(actor: AdminActor, db: Db, input: { id: string }) {
  authorize(actor, "audit.subject_opt_out");
  const { data, error } = await db.rpc("opt_out_subject", {
    p_subject_request_id: input.id,
    ...auditContext(actor),
  });
  if (error !== null) throw fromRpcError(error);
  return subjectFulfilledSchema.parse(data);
}
