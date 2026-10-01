import type { MarketSlug } from "../../domain/market";
import { t } from "../../lib/strings";

type StaticPath = "/properties" | "/stories" | "/exposure" | "/about" | "/submit";

/** A header link: a static page, or one of the three market desks. */
export type NavItem = { label: string } & (
  { to: StaticPath; market?: never } | { to?: never; market: MarketSlug }
);

/** Header navigation, left and right of the centred brand. */
export const primaryLinks: NavItem[] = [
  { to: "/properties", label: t.nav.properties },
  { market: "california", label: t.nav.california },
  { market: "new-york", label: t.nav.newYork },
  { market: "florida", label: t.nav.florida },
];

export const secondaryLinks: NavItem[] = [
  { to: "/stories", label: t.nav.stories },
  { to: "/exposure", label: t.nav.exposure },
  { to: "/about", label: t.nav.about },
];

/** The site's central call to action. */
export const submitLink: NavItem = { to: "/submit", label: t.nav.submit };
