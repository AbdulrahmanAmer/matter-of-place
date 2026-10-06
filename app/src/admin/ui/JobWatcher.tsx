import { StatusPill, type Tone } from "./StatusPill";

export interface WatchedJob {
  id: string;
  type: string;
  status: string;
}

const STATUS: Readonly<Record<string, { label: string; tone: Tone }>> = {
  queued: { label: "Queued", tone: "neutral" },
  running: { label: "Running", tone: "info" },
  done: { label: "Done", tone: "ok" },
  failed: { label: "Failed", tone: "danger" },
};

const words = (text: string) => text.replaceAll("_", " ");

/** The jobs an action started, each with its state; the caller refreshes `jobs` while any is not finished. */
export function JobWatcher({ jobs }: { jobs: readonly WatchedJob[] }) {
  if (jobs.length === 0) return null;
  return (
    <ul className="admin-jobs" aria-label="Jobs started" aria-live="polite">
      {jobs.map((job) => {
        const status = STATUS[job.status] ?? { label: words(job.status), tone: "neutral" as const };
        return (
          <li key={job.id}>
            <span>{words(job.type)}</span>
            <StatusPill label={status.label} tone={status.tone} />
          </li>
        );
      })}
    </ul>
  );
}
