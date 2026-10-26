import {
  requestStatusLines,
  requestTimeline,
  type AccountProperty,
  type TimelineStep,
} from "../../domain/account";
import { accountDay } from "./account-format";
import { AccountPhotos } from "./account-photos";

const stepNote = (step: TimelineStep, state: string): string => {
  if (step.status === "current")
    return step.at === null ? "Now" : `Now, since ${accountDay(state, step.at)}`;
  if (step.status === "upcoming") return "Not yet";
  if (step.status === "ended") return "Closed";
  return step.at === null ? "Done" : accountDay(state, step.at);
};

/**
 * My properties (W6 item 8): each request as a timeline from the day we received it to the live page, in the client's
 * words. The link to the live page appears only once the property is published; photographs can be added until the request is activated.
 */
export function AccountProperties({
  properties,
  onPhotosSent,
}: {
  properties: readonly AccountProperty[];
  /** Called once photographs have been sent, so the page reads the new counts. */
  onPhotosSent: () => void;
}) {
  if (properties.length === 0) {
    return <p>Nothing here yet. A property you submit to us appears here, with where it stands.</p>;
  }
  return (
    <ul className="account-list">
      {properties.map((property) => (
        <li key={property.id}>
          <h2>
            {property.address}, {property.city}
          </h2>
          <p>{requestStatusLines[property.workflow_state]}</p>
          <ol className="account-timeline" aria-label={`Where ${property.address} stands`}>
            {requestTimeline(property).map((step) => (
              <li
                key={step.label}
                data-status={step.status}
                aria-current={step.status === "current" ? "step" : undefined}
              >
                <span>{step.label}</span>
                <span>{stepNote(step, property.state)}</span>
              </li>
            ))}
          </ol>
          {property.live_path === null ? null : (
            <p>
              <a href={property.live_path}>See the live page</a>
            </p>
          )}
          {property.can_add_photos ? (
            <AccountPhotos
              submissionId={property.id}
              photos={property.photos}
              onSent={onPhotosSent}
            />
          ) : null}
        </li>
      ))}
    </ul>
  );
}
