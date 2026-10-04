import type { Json } from "../../db/index.ts";
import type { Db } from "./db.ts";
import { AppError } from "./errors.ts";

/** The event catalog of architecture 3.6, the same list as the check constraint on `events.type`. */
export const catalogEventTypes = [
  "submission.received",
  "submission.declined",
  "submission.accepted",
  "submission.awaiting_assets",
  "invoice.issued",
  "payment.marked",
  "submission.activated",
  "property.published",
  "property.unpublished",
  "asset.approved",
  "asset.rejected",
  "digest.due",
  "inquiry.received",
  "subscriber.created",
  "subscriber.confirmed",
  "invoice.voided",
  "health.failed",
  "subject_request.received",
] as const;

export type CatalogEventType = (typeof catalogEventTypes)[number];

/**
 * One catalog event from server code outside a transaction. A SQL write function emits its own event inside
 * its transaction, and no TS code emits one that a SQL function already emits (G20). Returns the event id.
 */
export async function emitEvent(
  db: Db,
  event: {
    type: CatalogEventType;
    entity: string;
    entityId: string;
    payload: { [key: string]: Json | undefined };
    actorId?: string;
  },
): Promise<string> {
  const { data, error } = await db.rpc("emit_event", {
    p_type: event.type,
    p_entity: event.entity,
    p_entity_id: event.entityId,
    p_payload: event.payload,
    ...(event.actorId === undefined ? {} : { p_actor_id: event.actorId }),
  });
  if (error !== null) {
    throw new AppError("unavailable", undefined, "The job system did not answer (emit_event).");
  }
  return data;
}
