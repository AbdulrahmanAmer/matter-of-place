import {
  disabledChannels,
  liveChannels,
  socialChannelLabels,
  type ChannelHealth,
  type ChannelIdsKey,
  type SocialChannel,
} from "../../domain/channels";
import { AdminApiError } from "../ui/admin-fetch";
import { useAdminMe } from "../ui/admin-me";
import { StatusPill } from "../ui/StatusPill";
import { AccountIdsForm } from "./AccountIdsForm";
import { useChannelHealth } from "./channels-queries";
import { HealthFacts } from "./HealthFacts";
import { levelLabel, levelTone } from "./health";

type Live = (typeof liveChannels)[number];

/** The settings row that holds each live channel's account ids; Instagram's holds Facebook's too. */
const idsKeyOf: Record<Live, ChannelIdsKey> = {
  instagram: "meta",
  x: "x",
  linkedin: "linkedin",
};

const isLive = (channel: SocialChannel): channel is Live => channel in idsKeyOf;

function Card({
  channel,
  health,
  canEditIds,
}: {
  channel: SocialChannel;
  health: ChannelHealth | undefined;
  canEditIds: boolean;
}) {
  const name = socialChannelLabels[channel];
  return (
    <article className="admin-channel" aria-label={name}>
      <header>
        <h2>{name}</h2>
        {health === undefined || !isLive(channel) ? null : (
          <StatusPill label={levelLabel[health.level]} tone={levelTone[health.level]} />
        )}
      </header>
      {isLive(channel) ? (
        <>
          {health === undefined ? (
            <div className="admin-skeleton" />
          ) : (
            <HealthFacts health={health} />
          )}
          {canEditIds ? <AccountIdsForm idsKey={idsKeyOf[channel]} /> : null}
        </>
      ) : (
        <p>Not enabled yet</p>
      )}
    </article>
  );
}

/** Screen 12, top: one card per channel. Facebook and YouTube exist as disabled blocks and say so (S48). */
export function ChannelCards() {
  const health = useChannelHealth();
  const { actions } = useAdminMe();
  const failure = health.error;
  return (
    <section className="admin-channels" aria-label="Channels">
      {failure === null ? null : (
        <p role="alert">
          {failure.message}
          {failure instanceof AdminApiError && failure.requestId !== undefined
            ? ` Request ${failure.requestId}.`
            : null}
        </p>
      )}
      {[...liveChannels, ...disabledChannels].map((channel) => (
        <Card
          key={channel}
          channel={channel}
          health={health.data?.find((item) => item.channel === channel)}
          canEditIds={actions.includes("channels.ids_put")}
        />
      ))}
    </section>
  );
}
