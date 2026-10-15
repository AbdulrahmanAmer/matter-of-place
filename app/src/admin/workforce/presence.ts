/**
 * Matter is online when the laptop has touched his row within the last three minutes: the workforce runner at the start
 * of every pass, and (remade 2026-10-15) his live supervisor once a minute while it runs, so a long pass of the
 * colleagues no longer reads as "offline".
 */
const ONLINE_WITHIN_MS = 3 * 60_000;

export type Presence =
  | { kind: "absent" }
  | { kind: "working"; task: string | null }
  | { kind: "online" }
  | { kind: "offline"; since: string | null };

/** What the panel says about Matter: never "online" when the laptop has stopped touching his row. */
export function presenceOf(input: {
  onTeam: boolean;
  lastSeen: string | null;
  now: number;
  state: string | null;
  task: string | null;
}): Presence {
  if (!input.onTeam) return { kind: "absent" };
  const online =
    input.lastSeen !== null && input.now - Date.parse(input.lastSeen) < ONLINE_WITHIN_MS;
  if (!online) return { kind: "offline", since: input.lastSeen };
  return input.state === "working" ? { kind: "working", task: input.task } : { kind: "online" };
}
