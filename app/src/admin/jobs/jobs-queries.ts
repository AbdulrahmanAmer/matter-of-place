import { useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { jobEntityKeys } from "../../domain/job-entities";
import { adminKeys, invalidateAfterWrite } from "../query";
import {
  approveJob,
  cancelJob,
  fetchJob,
  fetchJobs,
  retryBulk,
  retryJob,
  type Job,
} from "./jobs-api";

export type { Job, JobDetail } from "./jobs-api";

/** The filters of screen 16 that live in the address, beside the cursor. */
export const jobFilterNames = ["status", "type", "entity", "q"] as const;

export type JobFilterName = (typeof jobFilterNames)[number];

export type JobFilters = Readonly<Partial<Record<JobFilterName, string>>>;

/** The record a job belongs to: `kind` is its payload key without `_id` (`property`), `id` the uuid. */
export interface JobEntity {
  kind: string;
  id: string;
}

/** The first of `jobEntityKeys` that `payload.data` holds, or null for a system job. */
export function jobEntity(job: Pick<Job, "payload">): JobEntity | null {
  for (const key of jobEntityKeys) {
    const value = job.payload.data[key];
    if (typeof value === "string" && value !== "")
      return { kind: key.replace(/_id$/, ""), id: value };
  }
  return null;
}

// The features that keep a timeline for the record (`adminKeys.<feature>.timeline`).
const timelines: Readonly<Record<string, (id: string) => QueryKey>> = {
  submission: adminKeys.submissions.timeline,
  property: adminKeys.properties.timeline,
  payment: adminKeys.payments.timeline,
  asset: adminKeys.assets.timeline,
  inquiry: adminKeys.inquiries.timeline,
};

/** One page of the table: the filters of the address and the page's cursor. */
export function useJobs(filters: JobFilters, cursor: string | null) {
  const query: Record<string, string> = { ...filters, ...(cursor === null ? {} : { cursor }) };
  return useQuery({
    queryKey: adminKeys.jobs.list(query),
    queryFn: () => fetchJobs(query),
  });
}

/** The newest dead jobs, narrowed to `type` when one is chosen: what the banner pins above the table. */
export function useDeadJobs(type: string | undefined) {
  const query: Record<string, string> = {
    dead_only: "true",
    limit: "5",
    ...(type === undefined ? {} : { type }),
  };
  return useQuery({
    queryKey: adminKeys.jobs.list(query),
    queryFn: () => fetchJobs(query),
  });
}

export function useJob(id: string) {
  return useQuery({
    queryKey: adminKeys.jobs.detail(id),
    queryFn: () => fetchJob(id),
  });
}

/** What a write names: the job, and the record it belongs to so that record's timeline refreshes. */
interface JobTarget {
  id: string;
  entity: JobEntity | null;
}

function useJobAction(action: (id: string) => Promise<unknown>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: JobTarget) => action(id),
    onSettled: (_answer, _error, { entity }) =>
      invalidateAfterWrite(
        queryClient,
        adminKeys.jobs.all(),
        entity === null ? undefined : timelines[entity.kind]?.(entity.id),
      ),
  });
}

export const useRetryJob = () => useJobAction(retryJob);
export const useCancelJob = () => useJobAction(cancelJob);
export const useApproveJob = () => useJobAction(approveJob);

/** Retries every dead job of one type. */
export function useRetryBulk() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: retryBulk,
    onSettled: () => invalidateAfterWrite(queryClient, adminKeys.jobs.all()),
  });
}
