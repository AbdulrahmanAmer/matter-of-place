import { useState } from "react";
import type { DecisionAnswer, SubmissionDetail } from "../../domain/admin-submissions";
import { allowedActions } from "../../domain/admin-submissions";
import { JobWatcher, type WatchedJob } from "../ui/JobWatcher";
import { LocalTime } from "../ui/LocalTime";
import { StatusPill } from "../ui/StatusPill";
import { useToast } from "../ui/use-toast";
import { AcceptDialog } from "./AcceptDialog";
import { AssetsDialog } from "./AssetsDialog";
import { DeclineDialog } from "./DeclineDialog";
import { useAssetsReceived } from "./requests-queries";
import { marketSlugOf, stateTone } from "./state-tone";

type Letter = "decline" | "accept" | "request_assets";

const DONE: Record<Letter, string> = {
  decline: "Request declined.",
  accept: "Request accepted.",
  request_assets: "Material requested.",
};

/**
 * Where the request stands and the moves open to the actor: each shows only when the request's state allows it and
 * the actor holds its action. A move that sends a letter confirms in a dialog with the letter's preview, and the jobs
 * it started show below until the next move. Before B8 step 9 their states are the ones the answer carried. A dialog
 * stays mounted while the actor holds its action, so its answer still arrives after the request has moved on.
 */
export function DecisionPanel({
  detail,
  actions,
  pending,
  onStartReview,
}: {
  detail: SubmissionDetail;
  /** The actor's actions, from `GET /api/admin/me`. */
  actions: readonly string[];
  pending: boolean;
  onStartReview: () => void;
}) {
  const toast = useToast();
  const received = useAssetsReceived(detail.id);
  const [open, setOpen] = useState<Letter | null>(null);
  const [jobs, setJobs] = useState<readonly WatchedJob[]>([]);
  const offered = allowedActions(detail.workflow_state, {
    acceptedAt: detail.accepted_at,
    paymentStatus: null,
  }).filter((action) => actions.includes(`submissions.${action}`));
  const close = () => {
    setOpen(null);
  };
  const decided = (letter: Letter) => (answer: DecisionAnswer) => {
    setOpen(null);
    setJobs(answer.jobs);
    toast({ message: DONE[letter] });
  };

  return (
    <section className="admin-decision" aria-label="Status">
      <h2>Status</h2>
      <p>
        <StatusPill label={detail.workflow_state} tone={stateTone[detail.workflow_state]} />
      </p>
      {detail.accepted_at === null ? null : (
        <p className="admin-decision__meta">
          Accepted <LocalTime value={detail.accepted_at} marketSlug={marketSlugOf[detail.state]} />
        </p>
      )}
      {detail.workflow_state === "Declined" && detail.decline_note !== null ? (
        <p className="admin-prose">{detail.decline_note}</p>
      ) : null}
      {detail.property_id === null ? null : (
        <p>
          <a href={`/admin/properties/${detail.property_id}`}>Open property</a>
        </p>
      )}
      <div className="admin-actions">
        {offered.includes("start_review") ? (
          <button type="button" className="admin-button" disabled={pending} onClick={onStartReview}>
            Start review
          </button>
        ) : null}
        {offered.includes("accept") ? (
          <button
            type="button"
            className="admin-button"
            onClick={() => {
              setOpen("accept");
            }}
          >
            Accept
          </button>
        ) : null}
        {offered.includes("request_assets") ? (
          <button
            type="button"
            className="admin-button admin-button--quiet"
            onClick={() => {
              setOpen("request_assets");
            }}
          >
            Request material
          </button>
        ) : null}
        {offered.includes("assets_received") ? (
          <button
            type="button"
            className="admin-button"
            disabled={received.isPending}
            onClick={() => {
              received.mutate(undefined, {
                onSuccess: () => {
                  toast({ message: "Material received." });
                },
                onError: (error) => {
                  toast({ message: error.message, tone: "danger" });
                },
              });
            }}
          >
            Material received
          </button>
        ) : null}
        {offered.includes("decline") ? (
          <button
            type="button"
            className="admin-button admin-button--danger"
            onClick={() => {
              setOpen("decline");
            }}
          >
            Decline
          </button>
        ) : null}
      </div>
      <JobWatcher jobs={jobs} />
      {actions.includes("submissions.decline") ? (
        <DeclineDialog
          id={detail.id}
          open={open === "decline"}
          onClose={close}
          onDecided={decided("decline")}
        />
      ) : null}
      {actions.includes("submissions.accept") ? (
        <AcceptDialog
          id={detail.id}
          open={open === "accept"}
          onClose={close}
          onDecided={decided("accept")}
        />
      ) : null}
      {actions.includes("submissions.request_assets") ? (
        <AssetsDialog
          id={detail.id}
          open={open === "request_assets"}
          onClose={close}
          onDecided={decided("request_assets")}
        />
      ) : null}
    </section>
  );
}
