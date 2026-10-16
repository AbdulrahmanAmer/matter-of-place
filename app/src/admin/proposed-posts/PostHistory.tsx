import { useState } from "react";
import { LocalTime } from "../ui/LocalTime";
import { useProposedPost } from "./proposed-posts-queries";

/** The revisions of a post, read when the person opens them: who asked for each and what they wrote. */
export function PostHistory({ id }: { id: string }) {
  const [shown, setShown] = useState(false);
  const detail = useProposedPost(id, shown);
  return (
    <details
      className="admin-proposed__history"
      onToggle={(event) => {
        setShown(event.currentTarget.open);
      }}
    >
      <summary>History</summary>
      {detail.isPending && shown ? <p className="admin-asset__note">Loading.</p> : null}
      {detail.error === null ? null : (
        <p className="admin-asset__error" role="alert">
          {detail.error.message}
        </p>
      )}
      {detail.data === undefined ? null : detail.data.revisions.length === 0 ? (
        <p className="admin-asset__note">No earlier revisions.</p>
      ) : (
        <ol>
          {detail.data.revisions.map((revision) => (
            <li key={revision.revision}>
              Revision {revision.revision}, asked by {revision.requested_by},{" "}
              <LocalTime value={revision.created_at} />
              {revision.note === null ? null : `: ${revision.note}`}
            </li>
          ))}
        </ol>
      )}
    </details>
  );
}
