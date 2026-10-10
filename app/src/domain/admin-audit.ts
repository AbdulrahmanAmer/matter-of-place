import { z } from "zod";
import { adminPageAnswer, adminPageSchema } from "./admin-page.ts";
import { subjectRequestKinds } from "./contracts.ts";

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
const auditRowSchema = z.object({
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

// Data requests (B7 step 15a, invariant 15, GP-01): the second tab of screen 25 over B3's `subject_requests`.

const subjectRequestStatuses = ["received", "verifying", "fulfilled", "rejected"] as const;

/** `GET audit/subject-requests`: newest first, the cursor `received_at~id` of the last row of the page before. */
export const subjectRequestListInput = adminPageSchema;

export const subjectRequestRowSchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
  kind: z.enum(subjectRequestKinds),
  /** What the visitor wrote with the request. */
  note: z.string().nullable(),
  status: z.enum(subjectRequestStatuses),
  received_at: z.string(),
  due_at: z.string(),
  /** Set once identity is confirmed; every fulfilling action waits for it. */
  verified_at: z.string().nullable(),
  fulfilled_at: z.string().nullable(),
  handled_by: z.string().nullable(),
  /** Whole days until `due_at`, the 45 day clock; zero or less is overdue. */
  days_left: z.number().int(),
});

export type SubjectRequestRow = z.infer<typeof subjectRequestRowSchema>;

export const subjectRequestPageSchema = adminPageAnswer(subjectRequestRowSchema);

const subjectStatusActions = [
  "start_verification",
  "confirm_identity",
  "reject",
  "fulfil_correction",
] as const;

export type SubjectStatusAction = (typeof subjectStatusActions)[number];

/** The two actions that close a request without a fulfilling function name why in a note. */
export const noteRequired: readonly SubjectStatusAction[] = ["reject", "fulfil_correction"];

/** `POST audit/subject-requests/:id/status`. */
export const subjectStatusInput = z
  .object({
    id: z.string().uuid(),
    action: z.enum(subjectStatusActions),
    note: z.string().trim().max(1000).optional(),
  })
  .strict()
  .refine((input) => !noteRequired.includes(input.action) || (input.note ?? "") !== "", {
    message: "Add a note.",
    path: ["note"],
  });

export const subjectStatusAnswer = z.object({
  id: z.string().uuid(),
  status: z.enum(subjectRequestStatuses),
  verified_at: z.string().nullable(),
  fulfilled_at: z.string().nullable(),
  handled_by: z.string().nullable(),
});

/** `POST audit/subject-requests/:id/export`, `delete` and `opt-out`: the request alone. */
export const subjectActionInput = z.object({ id: z.string().uuid() }).strict();

/** The access bundle: every row the address appears in, as stored (S55). */
export const subjectExportSchema = z.object({
  request: z.object({ id: z.string().uuid(), kind: z.literal("access"), received_at: z.string() }),
  email: z.string(),
  subscribers: z.array(z.unknown()),
  inquiries: z.array(z.unknown()),
  contacts: z.array(z.unknown()),
  submissions: z.array(z.unknown()),
});

/** What `delete_subject` and `opt_out_subject` changed, as counts only. */
export const subjectFulfilledSchema = z.object({
  id: z.string().uuid(),
  status: z.literal("fulfilled"),
  counts: z.record(z.string(), z.number().int()),
});

// B14 step 4: the audit routine's own endpoints (GG-02, GG-03, G9).

/** `GET audit/usage`, `GET audit/health` and `POST audit/record-run` read no field; any body is ignored. */
export const auditNoInput = z.object({});

/** `GET audit/notfound`: the window in days, at most the 90 days `analytics_events` keeps. */
export const auditNotFoundQuery = z.object({
  days: z.coerce.number().int().min(1).max(90).default(7),
});

const isMonday = (date: string): boolean => new Date(`${date}T00:00:00Z`).getUTCDay() === 1;

/** `GET audit/kpis`: the Monday a week starts on; the last full week when absent. */
export const auditKpisQuery = z.object({
  week_start: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine(isMonday, { message: "Choose a Monday." })
    .optional(),
});

/** One retention row of `audit_health()`; `overdue` is null for a key judged by its last run alone (B8 GD-03). */
export const auditRetentionRowSchema = z.object({
  key: z.string(),
  last_run_at: z.string().nullable(),
  last_count: z.number().int().nullable(),
  overdue: z.number().int().nullable(),
});
