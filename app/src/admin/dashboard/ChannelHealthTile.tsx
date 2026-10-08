import { liveChannels, socialChannelLabels } from "../../domain/channels";
import { useChannelHealth } from "../channels/channels-queries";
import { HealthFacts } from "../channels/HealthFacts";
import { levelLabel, levelTone } from "../channels/health";
import { AdminApiError } from "../ui/admin-fetch";
import { StatusPill } from "../ui/StatusPill";

/**
 * Screen 2's channel health: for each channel that posts, its last post, last error and token days left. Facebook and
 * YouTube are disabled blocks (S48) and are left out. The takedown count of invariant 10 is the dashboard's own
 * "Withdraw by hand" tile.
 *
 * @public
 */
// STUB(B10 step 8): placed on screen 2 by B7's src/routes/admin/index.tsx, a file that is not on main yet
export function ChannelHealthTile() {
  const health = useChannelHealth();
  const failure = health.error;
  return (
    <section className="admin-channel-tile" aria-label="Channel health">
      <h2>Channels</h2>
      {failure === null ? null : (
        <p role="alert">
          {failure.message}
          {failure instanceof AdminApiError && failure.requestId !== undefined
            ? ` Request ${failure.requestId}.`
            : null}
        </p>
      )}
      {health.data === undefined && failure === null ? <div className="admin-skeleton" /> : null}
      <ul>
        {liveChannels.flatMap((channel) => {
          const row = health.data?.find((item) => item.channel === channel);
          return row === undefined
            ? []
            : [
                <li key={channel} aria-label={socialChannelLabels[channel]}>
                  <header>
                    <h3>{socialChannelLabels[channel]}</h3>
                    <StatusPill label={levelLabel[row.level]} tone={levelTone[row.level]} />
                  </header>
                  <HealthFacts health={row} />
                </li>,
              ];
        })}
      </ul>
      <a href="/admin/channels">Open channels</a>
    </section>
  );
}
