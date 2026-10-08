import type { ChannelHealth } from "../../domain/channels";
import { formatNumber } from "../../lib/format";
import { LocalTime } from "../ui/LocalTime";
import { tokenSummary } from "./health";
import { Permalink } from "./Permalink";

/** What a channel's health says, as the card of screen 12 and the tile of screen 2 both draw it. */
export function HealthFacts({ health }: { health: ChannelHealth }) {
  return (
    <dl className="admin-channel__facts">
      <div>
        <dt>Last post</dt>
        <dd>
          {health.lastPost === null ? (
            "None yet"
          ) : (
            <>
              <LocalTime value={health.lastPost.at} style="datetime" />{" "}
              <Permalink url={health.lastPost.permalink} />
            </>
          )}
        </dd>
      </div>
      <div>
        <dt>Last error</dt>
        <dd>
          {health.lastError === null ? (
            "None"
          ) : (
            <>
              <LocalTime value={health.lastError.at} style="datetime" /> {health.lastError.error}
            </>
          )}
        </dd>
      </div>
      <div>
        <dt>Token</dt>
        <dd>
          {tokenSummary(health)}
          {health.label === null ? null : ` (${health.label})`}
        </dd>
      </div>
      {health.reads === undefined ? null : (
        <div>
          <dt>Reads this month</dt>
          <dd>
            {formatNumber(health.reads.used)} of {formatNumber(health.reads.allowance)}
          </dd>
        </div>
      )}
    </dl>
  );
}
