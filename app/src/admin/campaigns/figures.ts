import type { Campaign } from "../../domain/admin-campaigns";
import { formatInZone } from "../../domain/market-time";
import type { Tone } from "../ui/StatusPill";

// How screen 33 words a campaign. There is no state column: the state is read from the dates, and a campaign with no
// start date is "Not scheduled", never guessed.

type CampaignState = "unscheduled" | "upcoming" | "running" | "ended";

export const stateLabel: Record<CampaignState, string> = {
  unscheduled: "Not scheduled",
  upcoming: "Upcoming",
  running: "Running",
  ended: "Ended",
};

export const stateTone: Record<CampaignState, Tone> = {
  unscheduled: "neutral",
  upcoming: "info",
  running: "ok",
  ended: "neutral",
};

/** `today` is an ISO date (`2026-10-15`): dates compare as text, as they are stored. */
export function campaignState(
  campaign: Pick<Campaign, "starts_on" | "ends_on">,
  today: string,
): CampaignState {
  const { starts_on: start, ends_on: end } = campaign;
  if (start === null) return "unscheduled";
  if (today < start) return "upcoming";
  if (end !== null && today > end) return "ended";
  return "running";
}

export const channelLabel = {
  homepage: "Homepage",
  featured: "Featured",
  newsletter: "Newsletter",
  social: "Social",
  programmatic: "Programmatic",
} as const;

export const channelStatusLabel = {
  none: "Not used",
  planned: "Planned",
  active: "Active",
  done: "Done",
} as const;

export const channelStatusTone: Record<keyof typeof channelStatusLabel, Tone> = {
  none: "neutral",
  planned: "info",
  active: "ok",
  done: "neutral",
};

/** `Oct 5, 2026` for a stored date, read in UTC so the day never shifts. */
const dateLabel = (date: string): string =>
  formatInZone(`${date}T00:00:00Z`, "UTC", "date").replace(" UTC", "");

/** The campaign's dates in one cell: `Oct 5, 2026 to Nov 5, 2026`, `From Oct 5, 2026` when open ended. */
export const datesLabel = (campaign: Pick<Campaign, "starts_on" | "ends_on">): string => {
  const { starts_on: start, ends_on: end } = campaign;
  if (start === null) return "Not scheduled";
  return end === null ? `From ${dateLabel(start)}` : `${dateLabel(start)} to ${dateLabel(end)}`;
};
