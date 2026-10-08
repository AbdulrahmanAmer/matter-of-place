import { useRouter, useRouterState } from "@tanstack/react-router";
import { AdminApiError } from "../ui/admin-fetch";
import { useUrlFilters } from "../ui/use-url-filters";
import { DeadLetterBanner } from "./DeadLetterBanner";
import { JobDrawer } from "./JobDrawer";
import { JobsTable } from "./JobsTable";
import { jobFilterNames, useJobs } from "./jobs-queries";

const OPEN = "job";

/** The open job lives in the address beside the filters, so a link opens the drawer and the back button closes it. */
function useOpenJob() {
  const router = useRouter();
  const location = useRouterState({ select: (state) => state.location });
  const params = new URLSearchParams(location.searchStr);
  const go = (next: URLSearchParams) => {
    const search = next.size === 0 ? "" : `?${next.toString()}`;
    void router.navigate({ href: `${location.pathname}${search}` });
  };
  return {
    id: params.get(OPEN),
    open: (id: string) => {
      const next = new URLSearchParams(params);
      next.set(OPEN, id);
      go(next);
    },
    close: () => {
      const next = new URLSearchParams(params);
      next.delete(OPEN);
      go(next);
    },
  };
}

/**
 * Screen 16. Dead jobs are pinned above the table; the table pages by keyset cursor and is narrowed by the address
 * (`status`, `type`, `entity`, `q`); a row, or Details on a dead job, opens the job's drawer through `job`.
 */
export function JobsPage() {
  const filters = useUrlFilters(jobFilterNames);
  const openJob = useOpenJob();
  const jobs = useJobs(filters.values, filters.cursor);
  const failure = jobs.error;
  const nextCursor = jobs.data?.next_cursor ?? null;
  return (
    <>
      <h1>Jobs</h1>
      <DeadLetterBanner
        type={filters.values.type}
        onOpen={(job) => {
          openJob.open(job.id);
        }}
      />
      {filters.values.entity === undefined ? null : (
        <p>
          The jobs of one record. <a href="/admin/jobs">Show every job</a>
        </p>
      )}
      <JobsTable
        filters={{ values: filters.values, onChange: filters.setFilters }}
        rows={jobs.data?.items ?? []}
        loading={jobs.isPending}
        error={
          failure === null
            ? null
            : {
                message: failure.message,
                ...(failure instanceof AdminApiError && failure.requestId !== undefined
                  ? { requestId: failure.requestId }
                  : {}),
              }
        }
        onOpen={(job) => {
          openJob.open(job.id);
        }}
        pager={{
          hasPrevious: filters.hasPrevious,
          hasNext: nextCursor !== null,
          onPrevious: filters.goPrevious,
          onNext: () => {
            if (nextCursor !== null) filters.goNext(nextCursor);
          },
        }}
      />
      {openJob.id === null ? null : (
        <JobDrawer key={openJob.id} id={openJob.id} onClose={openJob.close} />
      )}
    </>
  );
}
