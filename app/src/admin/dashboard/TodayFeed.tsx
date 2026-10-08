import type { TodayEntry } from "../../domain/admin-dashboard";
import { EmptyState } from "../ui/EmptyState";
import { Timeline, type TimelineEntry } from "../ui/Timeline";

/** An audit action id in words: `submissions.start_review` reads "submissions: start review". */
const actionText = (action: string) => action.replace(".", ": ").replaceAll("_", " ");

function entryOf(row: TodayEntry): TimelineEntry {
  const kind = row.actor_kind === "agent" ? "agent" : row.actor_id === null ? "system" : "human";
  const fallback = { agent: "Agent", system: "System", human: "Team member" }[kind];
  return {
    id: String(row.id),
    at: row.at,
    text: actionText(row.action),
    actorName: row.actor_name ?? fallback,
    actorKind: kind,
  };
}

/** What happened today: the newest audit rows of the current UTC day, each with who did it. */
export function TodayFeed({ entries }: { entries: readonly TodayEntry[] }) {
  return (
    <section className="admin-today" aria-label="What happened today">
      <h2>What happened today</h2>
      {entries.length === 0 ? (
        <EmptyState title="Nothing recorded yet today" />
      ) : (
        <Timeline entries={entries.map(entryOf)} />
      )}
    </section>
  );
}
