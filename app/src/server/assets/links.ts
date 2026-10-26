// The one address a caption or a block carries to a property page (B9 invariant 5). Every link in a post comes from
// here, so GA4 and the attribution tables see one source and one medium per channel.

const SITE_ORIGIN = "https://matterofplace.com";

const MEDIUM = {
  instagram: "social",
  x: "social",
  linkedin: "social",
  facebook: "social",
  newsletter: "email",
} as const;

export type LinkChannel = keyof typeof MEDIUM;

/** The X limit counts any link at this many characters (ASSUMED 23, UNPROVEN until B10 step 3a). */
export const X_LINK_LENGTH = 23;

function tracked(path: string, channel: LinkChannel, campaign: string): string {
  return `${SITE_ORIGIN}${path}?utm_source=${channel}&utm_medium=${MEDIUM[channel]}&utm_campaign=${campaign}`;
}

export function propertyLink(slug: string, channel: LinkChannel): string {
  return tracked(`/property/${slug}`, channel, slug);
}

/**
 * W8 item 1: a brand post's address, the home page or a market's page (where the market's interest signup is while it
 * holds no property), with the post's own campaign name.
 */
export function brandLink(market: string | null, channel: LinkChannel, campaign: string): string {
  return tracked(`/${market ?? ""}`, channel, campaign);
}
