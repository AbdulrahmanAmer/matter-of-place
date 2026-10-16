import type { AccountRequest } from "../../domain/account";
import { formatInZone, marketTimezone } from "../../domain/market-time";

/** The day a request arrived, in its own market's time ("Oct 2, 2026 PT"). */
const received = (request: AccountRequest): string =>
  formatInZone(
    request.received_at,
    marketTimezone(request.state === "California" ? "california" : null),
    "date",
  );

/**
 * The client room (W6 item 7): the person's own requests, by address and where each one stands. Item 8 adds the
 * pages inside it.
 */
export function AccountRoom({
  name,
  email,
  requests,
  onSignOut,
  signingOut,
}: {
  name: string;
  email: string;
  requests: readonly AccountRequest[];
  onSignOut: () => void;
  signingOut: boolean;
}) {
  // The name and the address together, so a person signed in by someone else's link sees whose room this is.
  return (
    <div className="copy-page">
      <p>
        Signed in as {name}, {email}.
      </p>
      <h2>Your requests</h2>
      {requests.length === 0 ? (
        <p>Nothing here yet. A property you submit to us appears here, with where it stands.</p>
      ) : (
        <ul>
          {requests.map((request) => (
            <li key={request.id}>
              <p>
                {request.address}, {request.city}
              </p>
              <p>
                {request.workflow_state}. Received {received(request)}.
              </p>
            </li>
          ))}
        </ul>
      )}
      <div className="form-actions">
        <button type="button" className="button" onClick={onSignOut} disabled={signingOut}>
          Sign out
        </button>
      </div>
    </div>
  );
}
