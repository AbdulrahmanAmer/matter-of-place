import type { AuditListInput } from "../../domain/admin-audit.ts";
import { fromRpcError } from "./admin-errors.ts";
import type { AdminActor } from "./actor-types.ts";
import type { ActorKind } from "./authz.ts";
import type { Db } from "./db.ts";
import { AppError } from "./errors.ts";

/** The actor triple every admin write function takes and hands to `write_audit` (invariants 1 and 18). */
export interface AuditArgs {
  p_actor: string;
  p_actor_kind: ActorKind;
  p_request_id: string;
}

export function auditContext(actor: AdminActor): AuditArgs {
  return { p_actor: actor.userId, p_actor_kind: actor.kind, p_request_id: actor.requestId };
}

const AUDIT_COLUMNS =
  "id, at, actor_id, actor_kind, action, entity, entity_id, before, after, request_id, note";

/** A page starts after the row it names: its `at` exactly as listed, then its id. */
const CURSOR = /^(\d{4}-\d\d-\d\dT[\d:.]+(?:Z|[+-]\d\d:\d\d))~(\d{1,19})$/;

function filtered(db: Db, input: AuditListInput) {
  let query = db.from("audit_log").select(AUDIT_COLUMNS);
  if (input.actor !== undefined) query = query.eq("actor_id", input.actor);
  if (input.kind !== undefined) query = query.eq("actor_kind", input.kind);
  if (input.action !== undefined) query = query.eq("action", input.action);
  if (input.entity !== undefined) query = query.eq("entity", input.entity);
  if (input.request_id !== undefined) query = query.eq("request_id", input.request_id);
  if (input.from !== undefined) query = query.gte("at", input.from);
  if (input.to !== undefined) query = query.lt("at", input.to);
  return query;
}

type AuditQuery = ReturnType<typeof filtered>;

async function newestFirst(query: AuditQuery, take: number) {
  const { data, error } = await query
    .order("at", { ascending: false })
    .order("id", { ascending: false })
    .limit(take);
  if (error !== null) throw fromRpcError(error);
  return data;
}

/** The rows after the cursor's `(at, id)` with AND filters only (R44): its ties first, then older rows. */
async function after(db: Db, input: AuditListInput, cursor: string, take: number) {
  const [, at, id] = CURSOR.exec(cursor) ?? [];
  if (at === undefined || id === undefined) {
    throw new AppError("validation", undefined, "This page link is no longer valid.");
  }
  const ties = await newestFirst(filtered(db, input).eq("at", at).lt("id", Number(id)), take);
  if (ties.length >= take) return ties;
  return [...ties, ...(await newestFirst(filtered(db, input).lt("at", at), take - ties.length))];
}

export type AuditLogRow = Awaited<ReturnType<typeof newestFirst>>[number];

/**
 * Screen 25's reader: one keyset page of `audit_log`, newest first, on B7's `audit_log (at desc, id desc)` index.
 * The caller has authorized the read; `input` is already parsed.
 */
export async function listAudit(
  db: Db,
  input: AuditListInput,
): Promise<{ items: AuditLogRow[]; next_cursor: string | null }> {
  const take = input.limit + 1;
  const { cursor } = input;
  const rows = await (cursor === undefined
    ? newestFirst(filtered(db, input), take)
    : after(db, input, cursor, take));
  const items = rows.slice(0, input.limit);
  // A row past the page means another page starts after its last row.
  const last = rows.length > input.limit ? items.at(-1) : undefined;
  return { items, next_cursor: last === undefined ? null : `${last.at}~${String(last.id)}` };
}
