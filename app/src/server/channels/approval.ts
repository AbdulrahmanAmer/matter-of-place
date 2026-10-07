import { effectiveApprovalMode, type ChannelSettings } from "../../domain/automation.ts";
import type { Tier } from "../../domain/events.ts";
import type { Principal } from "../lib/authz.ts";

// Who may approve an asset for posting (B10 invariant 4, S23). A person always may. An agent, or the system, may
// only when every enabled target channel is in `auto` for the tier; `effectiveApprovalMode` decides each channel.

type ApprovalRow = Pick<ChannelSettings, "approval_mode" | "auto_after">;

/**
 * `channelRows` are the `channel_settings` rows of the asset's target channels and `today` is `YYYY-MM-DD`. A kind
 * with no enabled target is never automatic.
 */
export function mayApprove(
  actor: Pick<Principal, "kind">,
  tier: Tier,
  channelRows: (ApprovalRow & { enabled: boolean })[],
  today: string,
): boolean {
  if (actor.kind === "human") return true;
  const enabled = channelRows.filter((row) => row.enabled);
  return (
    enabled.length > 0 && enabled.every((row) => effectiveApprovalMode(row, tier, today) === "auto")
  );
}

/**
 * The re-check before a post (invariant 4): an approval by a person holds; one by an agent, by the system (a null
 * `approved_by`) or by a user without a role row holds only while this channel is `auto` for the tier.
 */
export function approvalStillValid(
  asset: { approved_by: string | null; tier: Tier },
  approver: { actor_kind: "human" | "agent" } | null,
  row: ApprovalRow,
  today: string,
): boolean {
  if (asset.approved_by !== null && approver?.actor_kind === "human") return true;
  return effectiveApprovalMode(row, asset.tier, today) === "auto";
}
