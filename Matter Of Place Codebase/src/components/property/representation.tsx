import type { Property } from "../../domain/property";
import { TextButton } from "../site/text-link";

export function Representation({
  property,
  onContact,
  onShowing,
}: {
  property: Property;
  onContact: () => void;
  onShowing: () => void;
}) {
  const agent = property.representation;
  return (
    <section className="representation-section">
      <div className="representation-grid">
        <div>
          <p className="eyebrow">REPRESENTATION</p>
          <h2>Represented by</h2>
          {agent ? (
            <div className="representation-card">
              <strong>{agent.name}</strong>
              <span>{agent.brokerage}</span>
              {agent.license && <span>{agent.license}</span>}
            </div>
          ) : (
            <p className="representation-note">
              No brokerage is attached to this illustrative property. Matter of Place is not the
              listing brokerage; on live listings the representative, brokerage and licence appear
              here.
            </p>
          )}
        </div>
        <div className="representation-actions">
          <TextButton onClick={onContact}>Contact listing representative</TextButton>
          <TextButton onClick={onShowing}>Request a private showing</TextButton>
        </div>
      </div>
    </section>
  );
}
