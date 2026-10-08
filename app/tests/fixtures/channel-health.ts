import type { ChannelHealth } from "../../src/domain/channels";

/** One row of `GET /api/admin/channels/health` for the component tests of screen 12 and the screen 2 tile. */
export const channelHealth = (
  channel: ChannelHealth["channel"],
  over: Partial<ChannelHealth> = {},
): ChannelHealth => ({
  channel,
  connected: true,
  level: "ok",
  label: null,
  lastPost: null,
  lastError: null,
  token: { expiresAt: "2026-12-31T00:00:00.000Z", daysLeft: 85, level: "ok" },
  ...over,
});
