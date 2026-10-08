import { useState } from "react";
import { AdminApiError } from "../ui/admin-fetch";
import { useAdminMe } from "../ui/admin-me";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { Drawer } from "../ui/Drawer";
import { LocalTime } from "../ui/LocalTime";
import { useToast } from "../ui/use-toast";
import { JobStatus } from "./JobStatus";
import {
  jobEntity,
  useApproveJob,
  useCancelJob,
  useJob,
  useRetryJob,
  type JobDetail,
} from "./jobs-queries";

const words = (text: string) => text.replaceAll("_", " ");

const json = (value: unknown) => JSON.stringify(value, null, 2);

const RETRYABLE = new Set(["dead", "failed"]);
const CANCELLABLE = new Set(["queued", "failed", "waiting_approval"]);

function JobActions({ job }: { job: JobDetail }) {
  const { actions } = useAdminMe();
  const toast = useToast();
  const retry = useRetryJob();
  const cancel = useCancelJob();
  const approve = useApproveJob();
  const [asking, setAsking] = useState<"cancel" | "approve" | null>(null);
  const target = { id: job.id, entity: jobEntity(job) };
  const settle = (done: string) => ({
    onSuccess: () => {
      setAsking(null);
      toast({ message: done });
    },
    onError: (error: Error) => {
      setAsking(null);
      toast({ message: error.message, tone: "danger" });
    },
  });
  const close = () => {
    setAsking(null);
  };
  return (
    <div className="admin-actions">
      {RETRYABLE.has(job.status) && actions.includes("jobs.retry") ? (
        <button
          type="button"
          className="admin-button"
          disabled={retry.isPending}
          onClick={() => {
            retry.mutate(target, settle("Job queued again."));
          }}
        >
          Retry
        </button>
      ) : null}
      {job.status === "waiting_approval" && actions.includes("jobs.approve") ? (
        <button
          type="button"
          className="admin-button"
          onClick={() => {
            setAsking("approve");
          }}
        >
          Approve
        </button>
      ) : null}
      {CANCELLABLE.has(job.status) && actions.includes("jobs.cancel") ? (
        <button
          type="button"
          className="admin-button admin-button--quiet"
          onClick={() => {
            setAsking("cancel");
          }}
        >
          Cancel job
        </button>
      ) : null}
      <ConfirmDialog
        open={asking === "approve"}
        title="Approve this job"
        confirmLabel="Approve"
        pending={approve.isPending}
        onCancel={close}
        onConfirm={() => {
          approve.mutate(target, settle("Job approved."));
        }}
      >
        <p>The job is queued and runs as soon as a runner takes it.</p>
      </ConfirmDialog>
      <ConfirmDialog
        open={asking === "cancel"}
        title="Cancel this job"
        confirmLabel="Cancel job"
        danger
        pending={cancel.isPending}
        onCancel={close}
        onConfirm={() => {
          cancel.mutate(target, settle("Job cancelled."));
        }}
      >
        <p>The job will not run.</p>
      </ConfirmDialog>
    </div>
  );
}

function JobBody({ job }: { job: JobDetail }) {
  const entity = jobEntity(job);
  return (
    <>
      <dl className="admin-job__facts">
        <div>
          <dt>Status</dt>
          <dd>
            <JobStatus job={job} />
          </dd>
        </div>
        <div>
          <dt>Attempts</dt>
          <dd>
            {job.attempts} of {job.max_attempts}
          </dd>
        </div>
        <div>
          <dt>Entity</dt>
          <dd>{entity === null ? "system" : `${entity.kind} ${entity.id}`}</dd>
        </div>
        <div>
          <dt>Created</dt>
          <dd>
            <LocalTime value={job.created_at} />
          </dd>
        </div>
        <div>
          <dt>Runs after</dt>
          <dd>
            <LocalTime value={job.run_after} />
          </dd>
        </div>
        <div>
          <dt>Key</dt>
          <dd>{job.idempotency_key}</dd>
        </div>
        <div>
          <dt>Error</dt>
          <dd>{job.error ?? "None"}</dd>
        </div>
      </dl>
      <JobActions job={job} />
      <h3>Payload</h3>
      <pre className="admin-job__json">{json(job.payload)}</pre>
      {job.result === undefined || job.result === null ? null : (
        <>
          <h3>Result</h3>
          <pre className="admin-job__json">{json(job.result)}</pre>
        </>
      )}
      <h3>History</h3>
      <ol className="admin-timeline">
        {job.events.map((event) => (
          <li key={event.id}>
            <p>
              {words(event.kind)}
              {event.from_status === null || event.to_status === null
                ? null
                : `, ${words(event.from_status)} to ${words(event.to_status)}`}
              {event.message === null ? null : `: ${event.message}`}
            </p>
            <p className="admin-timeline__meta">
              <LocalTime value={event.at} />
            </p>
          </li>
        ))}
      </ol>
    </>
  );
}

/** The open job of screen 16: its facts, actions for the roles that have them, its payload and its transitions. */
export function JobDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const job = useJob(id);
  const failure = job.error;
  return (
    <Drawer open onClose={onClose} title={job.data === undefined ? "Job" : words(job.data.type)}>
      {failure === null ? null : (
        <p role="alert">
          {failure.message}
          {failure instanceof AdminApiError && failure.requestId !== undefined
            ? ` Request ${failure.requestId}.`
            : null}
        </p>
      )}
      {job.data === undefined ? (
        failure === null ? (
          <div className="admin-skeleton" />
        ) : null
      ) : (
        <JobBody job={job.data} />
      )}
    </Drawer>
  );
}
