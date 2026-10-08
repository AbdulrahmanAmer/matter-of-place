import type { PropertyMedia } from "../../domain/admin-properties";
import { EmptyState } from "../ui/EmptyState";
import { StatusPill } from "../ui/StatusPill";

/**
 * Screen 8, Sequence: the photographs in order, the first being the hero. Read only in this step; uploading, order and
 * alt text arrive with the media screen (step 8). Orientation is shown, never edited, and is blank until the render
 * has run (G63).
 */
export function SequenceTab({ media }: { media: readonly PropertyMedia[] }) {
  if (media.length === 0) {
    return (
      <EmptyState title="No photographs yet">
        Photographs of an accepted request arrive here once they are copied.
      </EmptyState>
    );
  }
  return (
    <div className="admin-table-wrap">
      <table className="admin-table">
        <caption>Photographs in sequence</caption>
        <thead>
          <tr>
            <th scope="col">Position</th>
            <th scope="col">State</th>
            <th scope="col">Alt text</th>
            <th scope="col">Orientation</th>
          </tr>
        </thead>
        <tbody>
          {media.map((row, index) => (
            <tr key={row.id}>
              <td>{index === 0 ? "1, hero" : String(index + 1)}</td>
              <td>
                {row.media_key === null ? (
                  <StatusPill label="Staged" tone="warning" />
                ) : (
                  <StatusPill label="Ready" tone="ok" />
                )}
              </td>
              <td>{row.alt ?? ""}</td>
              <td>{row.orientation ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
