import type { AdminActor } from "./admin-route.ts";
import type { ActorKind } from "./authz.ts";

/** The actor triple every admin write function takes and hands to `write_audit` (invariants 1 and 18). */
export interface AuditArgs {
  p_actor: string;
  p_actor_kind: ActorKind;
  p_request_id: string;
}

export function auditContext(actor: AdminActor): AuditArgs {
  return { p_actor: actor.userId, p_actor_kind: actor.kind, p_request_id: actor.requestId };
}
