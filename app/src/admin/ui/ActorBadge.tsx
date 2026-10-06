import { StatusPill } from "./StatusPill";

export type ActorKind = "human" | "agent" | "system";

/** A name, and the pill that tells an agent's work from a person's. */
export function ActorBadge({ name, kind }: { name: string; kind: ActorKind }) {
  return (
    <span className="admin-actor">
      {name}
      {kind === "agent" ? <StatusPill label="Agent" tone="info" /> : null}
    </span>
  );
}
