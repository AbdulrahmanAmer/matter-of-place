import { z } from "zod";
import { adminPageAnswer } from "../../domain/admin-page";
import { adminFetch } from "../ui/admin-fetch";

// The browser side of screen 16. Components reach these through `jobs-queries.ts`. Each schema reads only the
// fields the screen shows.

const fields = z.record(z.string(), z.unknown());

/** `{ params, data }` (B8 contract); a payload of another shape reads as empty rather than failing the whole page. */
const payloadSchema = z
  .object({ params: fields.default({}), data: fields.default({}) })
  .catch({ params: {}, data: {} });

const jobSchema = z.object({
  id: z.string(),
  type: z.string(),
  status: z.string(),
  attempts: z.number(),
  max_attempts: z.number(),
  run_after: z.string(),
  run_local: z.boolean(),
  payload: payloadSchema,
  result: z.unknown(),
  error: z.string().nullable(),
  idempotency_key: z.string(),
  created_at: z.string(),
  finished_at: z.string().nullable(),
});

const jobEventSchema = z.object({
  id: z.number(),
  at: z.string(),
  kind: z.string(),
  from_status: z.string().nullable(),
  to_status: z.string().nullable(),
  attempt: z.number().nullable(),
  message: z.string().nullable(),
});

const jobDetailSchema = jobSchema.extend({ events: z.array(jobEventSchema) });

export type Job = z.infer<typeof jobSchema>;
export type JobDetail = z.infer<typeof jobDetailSchema>;

const jobPath = (id: string) => `/api/admin/jobs/${id}`;

/** One page of jobs; `query` holds the filters and the cursor exactly as `GET /api/admin/jobs` takes them. */
export function fetchJobs(query: Readonly<Record<string, string>>) {
  const search = new URLSearchParams(query).toString();
  return adminFetch(
    `/api/admin/jobs${search === "" ? "" : `?${search}`}`,
    adminPageAnswer(jobSchema),
  );
}

export function fetchJob(id: string) {
  return adminFetch(jobPath(id), jobDetailSchema);
}

const jobAnswer = z.object({ id: z.string(), status: z.string() });

const act = (id: string, action: "retry" | "cancel" | "approve") =>
  adminFetch(`${jobPath(id)}/${action}`, jobAnswer, { method: "POST" });

export const retryJob = (id: string) => act(id, "retry");
export const cancelJob = (id: string) => act(id, "cancel");
export const approveJob = (id: string) => act(id, "approve");

/** Retries every dead job of `type`; answers how many. */
export function retryBulk(type: string) {
  return adminFetch("/api/admin/jobs/retry-bulk", z.object({ count: z.number() }), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type }),
  });
}
