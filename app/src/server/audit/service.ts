import { auditListInputSchema } from "../../domain/admin-audit.ts";
import type { AdminActor } from "../lib/admin-route.ts";
import { listAudit } from "../lib/audit.ts";
import { authorize } from "../lib/authz.ts";
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
