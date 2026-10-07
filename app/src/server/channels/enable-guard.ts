import { z } from "zod";
import { socialChannelLabels, type SocialChannel } from "../../domain/channels.ts";
import type { Db } from "../lib/db.ts";
import { AppError } from "../lib/errors.ts";
import { getFlags } from "../lib/flags.ts";

// A social channel is switched on only with proof that its credentials work (B10 invariant 9). B8b's
// `putChannelSettings`, and its `restoreRevision` of a `channel_settings` row, call this whenever `enabled` goes from
// false to true. The ids are stored on screen 12; `token_checked_at` and `token_state` by the daily token checks.

const CHECK_MAX_AGE_MS = 48 * 60 * 60 * 1000;

const NEEDS: Record<
  Exclude<SocialChannel, "youtube">,
  { key: "meta" | "x" | "linkedin"; ids: string[]; tokenState: boolean }
> = {
  instagram: { key: "meta", ids: ["page_id", "ig_user_id"], tokenState: true },
  facebook: { key: "meta", ids: ["page_id", "ig_user_id"], tokenState: true },
  x: { key: "x", ids: ["user_id"], tokenState: false },
  linkedin: { key: "linkedin", ids: ["organization_urn"], tokenState: false },
};

const storedSchema = z.record(z.string(), z.unknown());

function unverified(channel: SocialChannel, item: string): AppError {
  return new AppError(
    "credentials_unverified",
    undefined,
    `${socialChannelLabels[channel]} cannot be switched on yet: ${item}.`,
  );
}

/**
 * Throws 422 `channel_locked`, `no_adapter` or `credentials_unverified` (naming what is missing) unless `channel`
 * may be switched on.
 */
export async function assertMayEnable(db: Db, channel: SocialChannel): Promise<void> {
  if (channel === "facebook" || channel === "youtube") {
    if (!(await getFlags(db)).new_channels) {
      throw new AppError(
        "channel_locked",
        undefined,
        `${socialChannelLabels[channel]} stays off until new channels are switched on.`,
      );
    }
  }
  if (channel === "youtube") {
    throw new AppError("no_adapter", undefined, "YouTube has no posting step yet.");
  }
  const need = NEEDS[channel];
  const { data, error } = await db.from("settings").select("value").eq("key", need.key);
  if (error !== null) {
    throw new AppError("unavailable", undefined, "The settings could not be read.");
  }
  const stored = storedSchema.safeParse(data[0]?.value).data ?? {};
  const text = (name: string) => {
    const value = stored[name];
    return typeof value === "string" && value !== "" ? value : null;
  };
  for (const id of need.ids) {
    if (text(id) === null) throw unverified(channel, `settings.${need.key}.${id} is not set`);
  }
  const checkedAt = Date.parse(text("token_checked_at") ?? "");
  if (Number.isNaN(checkedAt) || Date.now() - checkedAt > CHECK_MAX_AGE_MS) {
    throw unverified(channel, "the token was not checked in the last 48 hours (token_checked_at)");
  }
  if (need.tokenState && text("token_state") !== "ok") {
    throw unverified(channel, `token_state is ${text("token_state") ?? "not set"}`);
  }
}
