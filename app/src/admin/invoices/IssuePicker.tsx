import { AdminApiError } from "../ui/admin-fetch";
import { EmptyState } from "../ui/EmptyState";
import { LocalTime } from "../ui/LocalTime";
import { marketSlugOf } from "../requests/state-tone";
import { useSubmissions } from "../requests/requests-queries";

const ACCEPTED = { workflow_state: "Accepted" } as const;

/**
 * The accepted requests that have no invoice yet, each with a link to its draft. It adds no route: it reads the
 * request list of screen 3, which already answers for the state `Accepted` (at most one page of 50).
 */
export function IssuePicker() {
  const list = useSubmissions(ACCEPTED);
  if (list.error !== null) {
    const requestId = list.error instanceof AdminApiError ? list.error.requestId : undefined;
    return (
      <p role="alert">
        {list.error.message}
        {requestId === undefined ? null : ` Request ${requestId}.`}
      </p>
    );
  }
  if (list.data === undefined) return <p aria-busy="true">Loading accepted requests.</p>;
  if (list.data.items.length === 0) {
    return (
      <EmptyState title="No request is waiting for an invoice">
        A request appears here once it is accepted.
      </EmptyState>
    );
  }
  return (
    <ul className="admin-picker" aria-label="Accepted requests">
      {list.data.items.map((request) => (
        <li key={request.id}>
          <div>
            <strong>{request.address}</strong>
            <p className="admin-picker__meta">
              {request.submitter_name}, {request.package}
              {request.accepted_at === null ? null : (
                <>
                  , accepted{" "}
                  <LocalTime
                    value={request.accepted_at}
                    marketSlug={marketSlugOf[request.state]}
                    style="date"
                  />
                </>
              )}
            </p>
          </div>
          <a className="admin-button" href={`/admin/invoices/new?submission_id=${request.id}`}>
            Issue invoice
          </a>
        </li>
      ))}
    </ul>
  );
}
