import { ActorBadge, type ActorKind } from "./ActorBadge";
import { LocalTime } from "./LocalTime";

export interface TimelineEntry {
  id: string;
  at: string;
  text: string;
  actorName: string;
  actorKind: ActorKind;
}

/** Audit rows and job events for one entity, newest first as the server sends them. */
export function Timeline({
  entries,
  marketSlug,
}: {
  entries: readonly TimelineEntry[];
  marketSlug?: string | null;
}) {
  return (
    <ol className="admin-timeline">
      {entries.map((entry) => (
        <li key={entry.id}>
          <p>{entry.text}</p>
          <p className="admin-timeline__meta">
            <ActorBadge name={entry.actorName} kind={entry.actorKind} />
            <LocalTime value={entry.at} marketSlug={marketSlug} />
          </p>
        </li>
      ))}
    </ol>
  );
}
