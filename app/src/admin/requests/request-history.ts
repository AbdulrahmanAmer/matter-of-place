import type { TimelineEntry as ApiEntry } from "../../domain/admin-submissions";
import type { ActorKind } from "../ui/ActorBadge";
import type { TimelineEntry } from "../ui/Timeline";

const actionLabels: Readonly<Record<string, string>> = {
  "submissions.start_review": "Review started",
  "submissions.note": "Note added",
  "submissions.decline": "Declined",
  "submissions.accept": "Accepted",
  "submissions.request_assets": "Assets requested",
  "submissions.assets_received": "Assets received",
  "submissions.withdraw": "Withdrawn",
};

/** An audit row and a job event carry an actor id and a kind, not a name: the badge says who kind of actor it was. */
export function actorOf(
  actorId: string | null,
  kind: "human" | "agent" | null,
): { name: string; kind: ActorKind } {
  if (kind === "agent") return { name: "Agent", kind: "agent" };
  if (actorId === null) return { name: "System", kind: "system" };
  return { name: "Team member", kind: "human" };
}

/** One line of the history, in the words an editor reads. An action without a label shows its own id. */
export function historyEntry(entry: ApiEntry): TimelineEntry {
  const what =
    entry.source === "audit"
      ? (actionLabels[entry.action] ?? entry.action)
      : `${(entry.job_type ?? "Job").replaceAll("_", " ")}: ${entry.action}`;
  const actor = actorOf(entry.actor_id, entry.actor_kind);
  return {
    id: entry.id,
    at: entry.at,
    text: entry.note === null ? what : `${what}. ${entry.note}`,
    actorName: actor.name,
    actorKind: actor.kind,
  };
}
