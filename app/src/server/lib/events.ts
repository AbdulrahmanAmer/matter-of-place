import type { Db } from "./db.ts";
import { logLine } from "./log.ts";

// The event catalog of architecture 3.6, the same list as the check on `events.type` (B8's jobs migration).
// Writes that start an automation emit inside their SQL function (G20); this module is the one import for
// server code that runs outside such a transaction.

export type CatalogEventType =
  | "submission.received"
  | "submission.declined"
  | "submission.accepted"
  | "submission.awaiting_assets"
  | "invoice.issued"
  | "payment.marked"
  | "submission.activated"
  | "property.published"
  | "property.unpublished"
  | "asset.approved"
  | "asset.rejected"
  | "digest.due"
  | "inquiry.received"
  | "subscriber.created"
  | "subscriber.confirmed"
  | "invoice.voided"
  | "health.failed"
  | "subject_request.received";

export interface CatalogEvent {
  type: CatalogEventType;
  entity: string;
  entityId: string;
  payload: Record<string, unknown>;
  actorId?: string;
}

/** @public */
// STUB(B8 step 3): emit_event RPC returning the event id
export function emitEvent(_db: Db, event: CatalogEvent): Promise<string | null> {
  logLine("info", "event_pending", { type: event.type, entityId: event.entityId });
  return Promise.resolve(null);
}
