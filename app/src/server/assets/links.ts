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

export function propertyLink(slug: string, channel: LinkChannel): string {
  return `${SITE_ORIGIN}/property/${slug}?utm_source=${channel}&utm_medium=${MEDIUM[channel]}&utm_campaign=${slug}`;
}
