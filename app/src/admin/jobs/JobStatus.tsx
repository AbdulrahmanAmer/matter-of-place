import { StatusPill, type Tone } from "../ui/StatusPill";
import type { Job } from "./jobs-queries";

const STATUS: Readonly<Record<string, { label: string; tone: Tone }>> = {
  queued: { label: "Queued", tone: "neutral" },
  running: { label: "Running", tone: "info" },
  done: { label: "Done", tone: "ok" },
  failed: { label: "Failed", tone: "warning" },
  dead: { label: "Dead", tone: "danger" },
  waiting_approval: { label: "Waiting for approval", tone: "warning" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

/** A job's state as a word and a tone; a caption job the laptop runner has not taken yet says so (ruling H34 (2)). */
export function JobStatus({ job }: { job: Pick<Job, "status" | "run_local"> }) {
  if (job.run_local && (job.status === "queued" || job.status === "failed")) {
    return <StatusPill label="waiting for the caption runner" tone="info" />;
  }
  const view = STATUS[job.status] ?? { label: job.status.replaceAll("_", " "), tone: "neutral" };
  return <StatusPill label={view.label} tone={view.tone} />;
}
