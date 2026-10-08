import { useState } from "react";
import { AdminApiError } from "../ui/admin-fetch";
import { useAdminMe } from "../ui/admin-me";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { useToast } from "../ui/use-toast";
import { JobStatus } from "./JobStatus";
import { jobEntity, useDeadJobs, useRetryBulk, useRetryJob, type Job } from "./jobs-queries";

const words = (text: string) => text.replaceAll("_", " ");

function DeadRow({ job, onOpen }: { job: Job; onOpen: (job: Job) => void }) {
  const { actions } = useAdminMe();
  const toast = useToast();
  const retry = useRetryJob();
  return (
    <li>
      <span className="admin-dead__what">
        <a href={`/admin/jobs?type=${encodeURIComponent(job.type)}`}>{words(job.type)}</a>
        <JobStatus job={job} />
      </span>
      <span className="admin-dead__error">{job.error ?? "No error recorded"}</span>
      <span className="admin-actions">
        {actions.includes("jobs.retry") ? (
          <button
            type="button"
            className="admin-button admin-button--quiet"
            disabled={retry.isPending}
            onClick={() => {
              retry.mutate(
                { id: job.id, entity: jobEntity(job) },
                {
                  onSuccess: () => {
                    toast({ message: "Job queued again." });
                  },
                  onError: (error) => {
                    toast({ message: error.message, tone: "danger" });
                  },
                },
              );
            }}
          >
            Retry
          </button>
        ) : null}
        <button
          type="button"
          className="admin-button admin-button--quiet"
          onClick={() => {
            onOpen(job);
          }}
        >
          Details
        </button>
      </span>
    </li>
  );
}

function RetryAll({ type }: { type: string }) {
  const toast = useToast();
  const bulk = useRetryBulk();
  const [asking, setAsking] = useState(false);
  const close = () => {
    setAsking(false);
  };
  return (
    <div className="admin-actions">
      <button
        type="button"
        className="admin-button"
        disabled={bulk.isPending}
        onClick={() => {
          setAsking(true);
        }}
      >
        Retry all matching
      </button>
      <ConfirmDialog
        open={asking}
        title="Retry all matching dead jobs"
        confirmLabel="Retry dead jobs"
        pending={bulk.isPending}
        onCancel={close}
        onConfirm={() => {
          bulk.mutate(type, {
            onSuccess: ({ count }) => {
              close();
              toast({
                message: `${String(count)} dead ${count === 1 ? "job" : "jobs"} queued again.`,
              });
            },
            onError: (error) => {
              close();
              toast({ message: error.message, tone: "danger" });
            },
          });
        }}
      >
        <p>Every dead {words(type)} job runs again from the start.</p>
      </ConfirmDialog>
    </div>
  );
}

/**
 * The dead jobs, pinned above the table in red while any exist: the five newest, narrowed to the table's type filter.
 * "Retry all matching" queues every dead job of that type again, so the button is offered only once a type is chosen.
 */
export function DeadLetterBanner({
  type,
  onOpen,
}: {
  type: string | undefined;
  onOpen: (job: Job) => void;
}) {
  const { actions } = useAdminMe();
  const dead = useDeadJobs(type);
  const failure = dead.error;
  if (failure !== null) {
    return (
      <p role="alert">
        {failure.message}
        {failure instanceof AdminApiError && failure.requestId !== undefined
          ? ` Request ${failure.requestId}.`
          : null}
      </p>
    );
  }
  const jobs = dead.data?.items ?? [];
  if (jobs.length === 0) return null;
  const more = dead.data?.next_cursor !== null;
  return (
    <section className="admin-dead" aria-labelledby="admin-dead-title" data-tone="danger">
      <h2 id="admin-dead-title">Dead jobs</h2>
      <p>
        {more ? `The ${String(jobs.length)} newest are shown. ` : null}
        These jobs ran out of attempts. Retry runs one again from the start.
      </p>
      <ul>
        {jobs.map((job) => (
          <DeadRow key={job.id} job={job} onOpen={onOpen} />
        ))}
      </ul>
      {actions.includes("jobs.retry_bulk") ? (
        type === undefined ? (
          <p>Filter the table by a type to retry its dead jobs together.</p>
        ) : (
          <RetryAll type={type} />
        )
      ) : null}
    </section>
  );
}
