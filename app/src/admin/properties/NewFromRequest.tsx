import type { SubmissionListRow } from "../../domain/admin-submissions";
import { EmptyState } from "../ui/EmptyState";
import { RoleGate } from "../ui/RoleGate";

/**
 * Screen 7, "New from request": the accepted requests that have no property yet. Create property makes the draft and
 * queues the copy of its photographs; it is safe to press twice.
 */
export function NewFromRequest({
  requests,
  creating,
  onCreate,
}: {
  requests: readonly SubmissionListRow[];
  creating: string | null;
  onCreate: (submissionId: string) => void;
}) {
  return (
    <section className="admin-new-from-request" aria-labelledby="new-from-request">
      <h2 id="new-from-request">New from request</h2>
      {requests.length === 0 ? (
        <EmptyState title="Nothing waiting">Every accepted request has its property.</EmptyState>
      ) : (
        <ul>
          {requests.map((request) => (
            <li key={request.id}>
              <a href={`/admin/requests/${request.id}`}>
                {request.address}, {request.city}
              </a>
              <RoleGate action="properties.create_from_submission">
                <button
                  type="button"
                  className="admin-button admin-button--quiet"
                  disabled={creating !== null}
                  onClick={() => {
                    onCreate(request.id);
                  }}
                >
                  {creating === request.id ? "Creating" : "Create property"}
                </button>
              </RoleGate>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
