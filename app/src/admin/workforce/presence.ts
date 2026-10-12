/** Matter is online when the laptop's runner has passed within the last three minutes (it touches Matter's row). */
const ONLINE_WITHIN_MS = 3 * 60_000;

export type Presence =
  | { kind: "absent" }
  | { kind: "working" }
  | { kind: "online" }
  | { kind: "offline"; since: string | null };

/** What the side chat says about Matter: never "online" when the laptop has stopped passing. */
export function presenceOf(input: {
  onTeam: boolean;
  lastSeen: string | null;
  now: number;
  waiting: boolean;
}): Presence {
  if (!input.onTeam) return { kind: "absent" };
  const online =
    input.lastSeen !== null && input.now - Date.parse(input.lastSeen) < ONLINE_WITHIN_MS;
  if (!online) return { kind: "offline", since: input.lastSeen };
  return input.waiting ? { kind: "working" } : { kind: "online" };
}
