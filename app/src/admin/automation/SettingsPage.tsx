import { channels, type Channel } from "../../domain/automation";
import { useChannelHealth } from "../channels/channels-queries";
import { useChannelSettings, useFlags, useScheduleSettings } from "./automation-queries";
import { ChannelSettingsForm, type Credentials } from "./ChannelSettingsForm";
import { RequestFailure } from "./RequestFailure";
import { ScheduleSettingsForm } from "./ScheduleSettingsForm";

/**
 * A channel's sign-in from the health route of screen 12. A route that is missing or fails reads as not connected: the
 * screen never guesses a better answer, and it never shows the name or value of a secret (G-006).
 */
function credentialsOf(
  channel: Channel,
  health: ReturnType<typeof useChannelHealth>,
): Credentials | null {
  if (channel === "newsletter") return null;
  if (health.isPending) return "Checking";
  const found = health.data?.find((entry) => entry.channel === channel);
  if (found === undefined || !found.connected) return "Not connected";
  const { daysLeft } = found.token;
  return daysLeft !== null && daysLeft < 0 ? "Expired" : "Connected";
}

/** Screen 20: the posting window and approval of each channel, and the clocks that run the schedules. */
export function SettingsPage() {
  const channelRows = useChannelSettings();
  const schedules = useScheduleSettings();
  const flags = useFlags();
  const health = useChannelHealth();

  if (channelRows.isPending || schedules.isPending) return <p role="status">Loading settings.</p>;
  if (channelRows.isError) return <RequestFailure error={channelRows.error} />;
  if (schedules.isError) return <RequestFailure error={schedules.error} />;

  // Until the flags are known the two blocked channels stay off.
  const newChannels = flags.data?.new_channels === true;
  const ordered = channels.flatMap((channel) =>
    channelRows.data.items.filter((row) => row.channel === channel),
  );
  return (
    <>
      <h1>Channels and schedules</h1>
      <section aria-labelledby="channels-heading">
        <h2 id="channels-heading">Channels</h2>
        <p className="admin-recipes__intro">
          Where each channel posts and who approves it. A posting window is wall time in its own
          zone, so 09:00 stays 09:00 there across daylight saving.
        </p>
        <div className="admin-settings__list">
          {ordered.map((row) => (
            <ChannelSettingsForm
              key={JSON.stringify(row)}
              row={row}
              newChannels={newChannels}
              credentials={credentialsOf(row.channel, health)}
            />
          ))}
        </div>
      </section>
      <section aria-labelledby="schedules-heading">
        <h2 id="schedules-heading">Schedules</h2>
        <p className="admin-recipes__intro">
          Every clock is set in UTC. It moves one hour against local time when daylight saving
          starts and ends, twice a year, so the digest and the audit run an hour earlier or later on
          the wall clock.
        </p>
        <div className="admin-settings__list">
          {schedules.data.items.map((row) => (
            <ScheduleSettingsForm key={JSON.stringify(row)} row={row} />
          ))}
        </div>
      </section>
    </>
  );
}
