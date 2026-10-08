import type { ChannelHealth } from "../../domain/channels";
import { pluralize } from "../../lib/format";
import type { Tone } from "../ui/StatusPill";

export const levelTone: Record<ChannelHealth["level"], Tone> = {
  ok: "ok",
  amber: "warning",
  red: "danger",
};

/** Red covers a token with seven days or fewer, a dead token and a failed post that needs a new token. */
export const levelLabel: Record<ChannelHealth["level"], string> = {
  ok: "Working",
  amber: "Attention",
  red: "Reconnect needed",
};

/** The token line of a channel: whether it is connected at all, then when it stops working. */
export function tokenSummary(health: ChannelHealth): string {
  if (!health.connected) return "Not connected";
  const { expiresAt, daysLeft } = health.token;
  if (expiresAt === null || daysLeft === null) return "Never expires";
  if (daysLeft < 0) return "Expired";
  return `${String(daysLeft)} ${pluralize(daysLeft, "day")} left`;
}
