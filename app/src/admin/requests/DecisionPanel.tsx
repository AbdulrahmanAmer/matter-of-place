import type { SubmissionDetail } from "../../domain/admin-submissions";
import { allowedActions } from "../../domain/admin-submissions";
import { LocalTime } from "../ui/LocalTime";
import { StatusPill } from "../ui/StatusPill";
import { marketSlugOf, stateTone } from "./state-tone";

/** Where the request stands and the moves open to the actor. Start review is the only move this panel offers so far. */
export function DecisionPanel({
  detail,
  canStartReview,
  pending,
  onStartReview,
}: {
  detail: SubmissionDetail;
  /** The actor holds `submissions.start_review`. */
  canStartReview: boolean;
  pending: boolean;
  onStartReview: () => void;
}) {
  const offered = allowedActions(detail.workflow_state, {
    acceptedAt: detail.accepted_at,
    paymentStatus: null,
  });
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
      {canStartReview && offered.includes("start_review") ? (
        <button type="button" className="admin-button" disabled={pending} onClick={onStartReview}>
          Start review
        </button>
      ) : null}
    </section>
  );
}
