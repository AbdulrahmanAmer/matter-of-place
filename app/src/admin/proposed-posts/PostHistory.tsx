import { useState } from "react";
import { LocalTime } from "../ui/LocalTime";
import { useProposedPost } from "./proposed-posts-queries";

const reasonLabels = { rejected: "rejected", rerender: "sent to render again" } as const;

/** The revisions of a post, read when the person opens them: why each was made, who asked and what they wrote. */
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
              Revision {revision.revision}, {reasonLabels[revision.reason]} by{" "}
              {revision.asked_by_kind === "human" ? "a person" : "an agent"},{" "}
              <LocalTime value={revision.created_at} />: {revision.note}
            </li>
          ))}
        </ol>
      )}
    </details>
  );
}
