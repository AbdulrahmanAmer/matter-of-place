import { z } from "zod";
import {
  inquiryRowSchema,
  type Assignee,
  type InquiryDetail,
  type InquiryListInput,
  type InquiryRow,
  type InquiryState,
} from "../../domain/admin-inquiries";
import type { Inquiry, Receipt } from "../../domain/contracts";
import { isImplemented, type StepRegistry } from "../automation/catalog";
import { fromRpcError } from "../lib/admin-errors";
import type { AdminActor } from "../lib/admin-route";
import { auditContext } from "../lib/audit";
import { authorize, permission } from "../lib/authz";
import type { Db } from "../lib/db";
import { AppError } from "../lib/errors";
import type { PublicCtx } from "../public/routes";

const UNAVAILABLE = "We could not send this just now. Please try again in a moment.";

/** `POST /inquiries`: one row and its `inquiry.received` event through `create_inquiry` (G49, G20). */
export async function create(db: Db, input: Inquiry, ctx: PublicCtx): Promise<Receipt> {
  const { data, error } = await db.rpc("create_inquiry", {
    p: {
      intent: input.intent,
      topic: input.topic,
      subject_kind: input.subject?.kind,
      subject_slug: input.subject?.slug,
      subject_title: input.subject?.title,
      name: input.name,
      email: input.email,
      phone: input.phone,
      location: input.location,
      message: input.message,
      details: input.details,
      source_path: input.sourcePath,
      ip_hash: ctx.ipHash,
      turnstile_ok: ctx.turnstileOk,
      attribution: input.attribution,
    },
  });
  const row = data?.[0];
  if (error !== null || row === undefined)
    throw new AppError("unavailable", undefined, UNAVAILABLE);
  return { id: row.id, receivedAt: row.received_at };
}

// The admin side (B7 step 11, screen 11). Each function authorizes before it touches the database (SEC-04).

/** Whether Forward can do anything yet: true once B15 registers the `webhook_omnikom` step. */
const forwardAvailable = (registry?: StepRegistry) => isImplemented("webhook_omnikom", registry);

const listRowsSchema = z.array(inquiryRowSchema);

/** A page starts after the row it names: its id, and its `received_at` exactly as stored. */
const PAGE_AFTER = /^([0-9a-f-]{36})@(\d{4}-\d\d-\d\dT[\d:.]+(?:Z|[+-]\d\d:\d\d))$/;

function pageAfter(cursor: string): { p_after_id: string; p_after_received_at: string } {
  const [, id, at] = PAGE_AFTER.exec(cursor) ?? [];
  if (id === undefined || at === undefined) {
    throw new AppError("validation", undefined, "This page link is no longer valid.");
  }
  return { p_after_id: id, p_after_received_at: at };
}

/** `GET /api/admin/inquiries`: one page, newest first, through `list_inquiries` (invariant 17c). */
export async function listInquiries(
  actor: AdminActor,
  db: Db,
  input: InquiryListInput,
  registry?: StepRegistry,
): Promise<{ items: InquiryRow[]; next_cursor: string | null; forward_available: boolean }> {
  authorize(actor, "inquiries.list");
  const { data, error } = await db.rpc("list_inquiries", {
    p_limit: input.limit + 1,
    ...(input.state === undefined ? {} : { p_state: input.state }),
    ...(input.cursor === undefined ? {} : pageAfter(input.cursor)),
  });
  if (error !== null) throw fromRpcError(error);
  // One row more than the page tells whether another page follows.
  const rows = listRowsSchema.parse(data);
  const more = rows.length > input.limit;
  const items = more ? rows.slice(0, -1) : rows;
  const last = items.at(-1);
  return {
    items,
    next_cursor: more && last !== undefined ? `${last.id}@${last.received_at}` : null,
    forward_available: forwardAvailable(registry),
  };
}

/** `GET /api/admin/inquiries/:id`: the row the drawer shows, also when the list page does not hold it. */
export async function getInquiry(
  actor: AdminActor,
  db: Db,
  id: string,
  registry?: StepRegistry,
): Promise<InquiryDetail> {
  authorize(actor, "inquiries.get");
  const { data, error } = await db.from("inquiries").select("*").eq("id", id).maybeSingle();
  if (error !== null) throw fromRpcError(error);
  if (data === null) throw new AppError("not_found", undefined, "This inquiry does not exist.");
  return { ...inquiryRowSchema.parse(data), forward_available: forwardAvailable(registry) };
}

/** `GET /api/admin/inquiries/assignees`: everyone with an enabled role that may act on inquiries, once each. */
export async function listAssignees(actor: AdminActor, db: Db): Promise<{ items: Assignee[] }> {
  authorize(actor, "inquiries.assignees");
  const { data, error } = await db
    .from("user_roles")
    .select("user_id, display_name, disabled_at")
    .in("role", [...permission("inquiries.assign").roles])
    .eq("actor_kind", "human");
  if (error !== null) throw fromRpcError(error);
  const names = new Map<string, string>();
  for (const row of data.filter((role) => role.disabled_at === null)) {
    if (!names.has(row.user_id) || row.display_name !== null) {
      names.set(row.user_id, row.display_name ?? "Unnamed editor");
    }
  }
  const items = [...names].map(([id, name]) => ({ id, name }));
  return { items: items.sort((a, b) => a.name.localeCompare(b.name)) };
}

/** `POST /api/admin/inquiries/:id/assign`: a new inquiry moves to in progress (`assign_inquiry`). */
export async function assign(
  actor: AdminActor,
  db: Db,
  id: string,
  assignee: string,
): Promise<{ state: InquiryState }> {
  authorize(actor, "inquiries.assign");
  const { data, error } = await db.rpc("assign_inquiry", {
    p_inquiry_id: id,
    p_assignee: assignee,
    ...auditContext(actor),
  });
  if (error !== null) throw fromRpcError(error);
  return { state: data };
}

/** `POST /api/admin/inquiries/:id/forward`: queues one `webhook_omnikom` job; the state is the step's to change. */
export async function forward(actor: AdminActor, db: Db, id: string): Promise<{ job_id: string }> {
  authorize(actor, "inquiries.forward");
  const { data, error } = await db.rpc("forward_inquiry", {
    p_inquiry_id: id,
    ...auditContext(actor),
  });
  if (error !== null) throw fromRpcError(error);
  return { job_id: data };
}

/** `POST /api/admin/inquiries/:id/close` (`close_inquiry`). */
export async function close(
  actor: AdminActor,
  db: Db,
  id: string,
): Promise<{ state: InquiryState }> {
  authorize(actor, "inquiries.close");
  const { data, error } = await db.rpc("close_inquiry", {
    p_inquiry_id: id,
    ...auditContext(actor),
  });
  if (error !== null) throw fromRpcError(error);
  return { state: data };
}
