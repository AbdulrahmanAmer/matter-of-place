import { z } from "zod";
import type { Enums } from "../db/index.ts";
import { adminPageSchema } from "./admin-page.ts";

// Screen 16 (B8 step 9): the filters of the job list and the bulk retry of dead jobs. API JSON is the snake_case row
// shape of the generated types (G-004); `enums.check.ts` holds the status list to the `job_status` enum.

const uuid = z.string().uuid();

const jobStatuses = [
  "queued",
  "running",
  "done",
  "failed",
  "dead",
  "waiting_approval",
  "cancelled",
] as const satisfies readonly Enums<"job_status">[];

/** `GET /api/admin/jobs`: one keyset page on `(created_at desc, id desc)` (B7 invariant 17c). */
export const jobListSchema = adminPageSchema.extend({
  status: z.enum(jobStatuses).optional(),
  type: z.string().min(1).max(100).optional(),
  /** A submission, property, payment, asset, inquiry, subscriber or privacy request id, matched by `entityJobsFilter`. */
  entity: uuid.optional(),
  /** The jobs one event planned, for B7's JobWatcher. */
  event_id: uuid.optional(),
  // A query string says "true"; anything else that is not a boolean is refused.
  dead_only: z
    .preprocess(
      (value) => (value === "true" ? true : value === "false" ? false : value),
      z.boolean(),
    )
    .optional(),
  /** Text the job's error contains. */
  q: z.string().min(1).max(200).optional(),
});

export type JobListInput = z.infer<typeof jobListSchema>;

/** The path parameter of `GET /api/admin/jobs/:id` and of its retry, cancel and approve. */
export const jobIdSchema = z.object({ id: uuid });

/** `POST /api/admin/jobs/retry-bulk` (E2E-03): at least one filter, so a request never retries every dead job. */
export const jobRetryBulkSchema = z
  .object({
    type: z.string().min(1).max(100).optional(),
    error_like: z.string().min(1).max(200).optional(),
    /** ISO 8601 in UTC (`Z`); an offset is refused. */
    since: z.string().datetime().optional(),
  })
  .strict()
  .refine(
    (input) =>
      input.type !== undefined || input.error_like !== undefined || input.since !== undefined,
    { message: "Name a type, an error or a time." },
  );

export type JobRetryBulkInput = z.infer<typeof jobRetryBulkSchema>;
