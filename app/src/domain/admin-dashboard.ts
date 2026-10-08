import { z } from "zod";
import { submissionStates } from "./contracts.ts";

// Screen 2 (B7 step 9): the body of `GET /api/admin/dashboard`, the jsonb `admin_dashboard()` returns in one call
// (invariant 17d). Snake_case, as the function builds it.

const count = z.number().int().nonnegative();

/** One audit row of the current UTC day, newest first; `actor_name` is the actor's `user_roles.display_name`. */
const todayEntrySchema = z.object({
  id: z.number().int(),
  at: z.string(),
  action: z.string(),
  entity: z.string(),
  entity_id: z.string().nullable(),
  actor_id: z.string().nullable(),
  actor_kind: z.enum(["human", "agent"]).nullable(),
  actor_name: z.string().nullable(),
});

export type TodayEntry = z.infer<typeof todayEntrySchema>;

export const dashboardSchema = z.object({
  /** Requests per workflow state; a state with no request is absent. */
  counts: z.record(z.enum(submissionStates), count),
  jobs: z.object({ failed_24h: count, dead: count }),
  assets_pending: count,
  digest_next_at: z.string().nullable(),
  /** The last health run that finished, or null before the first. */
  health: z
    .object({ at: z.string(), failed: z.boolean(), failed_checks: z.array(z.string()) })
    .nullable(),
  email: z.object({ sent_today: count, sent_month: count, sent_7d: count, bounced_7d: count }),
  database_bytes: count,
  storage: z.object({ bytes: count }),
  /** Live posts a takedown left to withdraw by hand, and when the oldest was flagged. */
  withdraw: z.object({ open: count, oldest_at: z.string().nullable() }),
  today: z.array(todayEntrySchema),
});

export type Dashboard = z.infer<typeof dashboardSchema>;

/** Bounced or complained over sent in the last seven days; null when nothing was sent. */
export function bounceRate(email: Dashboard["email"]): number | null {
  return email.sent_7d === 0 ? null : email.bounced_7d / email.sent_7d;
}
