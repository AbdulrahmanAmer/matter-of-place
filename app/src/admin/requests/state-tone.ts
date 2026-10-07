import type { SubmissionListRow } from "../../domain/admin-submissions";
import type { WorkflowState } from "../../domain/workflow";
import type { Tone } from "../ui/StatusPill";

/** The tone of each state's pill, on the list and on the request itself. */
export const stateTone: Record<WorkflowState, Tone> = {
  Submitted: "info",
  "Under Review": "warning",
  "Awaiting Assets": "warning",
  Accepted: "ok",
  "Invoice Issued": "ok",
  Scheduled: "ok",
  Published: "ok",
  "Distribution Active": "ok",
  Completed: "neutral",
  Declined: "neutral",
  Withdrawn: "neutral",
};

/** The market of a request, as the slug `LocalTime` takes to name the zone. */
export const marketSlugOf: Record<SubmissionListRow["state"], string> = {
  California: "california",
  "New York": "new-york",
  Florida: "florida",
};
