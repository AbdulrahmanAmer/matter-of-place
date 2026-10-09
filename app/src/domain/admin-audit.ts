import { z } from "zod";
import { adminPageAnswer, adminPageSchema } from "./admin-page.ts";

// Screen 25 (B7 step 15): the filters of the audit log and its rows, in the snake_case shape of `audit_log` (G-004).

/** ISO 8601 with an offset, as the date inputs send it after converting the editor's day to UTC (GD-06). */
const instant = z.string().datetime({ offset: true });

/** `GET /api/admin/audit`: one keyset page on `(at desc, id desc)` (invariant 17c); every filter is an AND. */
export const auditListInputSchema = adminPageSchema.extend({
  actor: z.string().uuid().optional(),
  kind: z.enum(["human", "agent"]).optional(),
  action: z.string().min(1).max(100).optional(),
  entity: z.string().min(1).max(100).optional(),
  /** Rows at or after this instant. */
  from: instant.optional(),
  /** Rows before this instant. */
  to: instant.optional(),
  /** The `x-request-id` of one request: every row it wrote. */
  request_id: z.string().min(1).max(200).optional(),
});

export type AuditListInput = z.infer<typeof auditListInputSchema>;

/** The filters screen 25 keeps in its address, beside the cursor. */
export const auditFilterNames = [
  "actor",
  "kind",
  "action",
  "entity",
  "from",
  "to",
  "request_id",
] as const;

/** One audit row. `before` and `after` hold only the changed keys, personal data already redacted (invariant 18). */
export const auditRowSchema = z.object({
  id: z.number().int(),
  at: z.string(),
  actor_id: z.string().nullable(),
  actor_kind: z.enum(["human", "agent"]).nullable(),
  action: z.string(),
  entity: z.string(),
  entity_id: z.string().nullable(),
  /** Any JSON: most rows hold objects, a boolean key holds the value, a reorder holds an array. */
  before: z.unknown(),
  after: z.unknown(),
  request_id: z.string().nullable(),
  note: z.string().nullable(),
});

export type AuditRow = z.infer<typeof auditRowSchema>;

export const auditPageSchema = adminPageAnswer(auditRowSchema);
