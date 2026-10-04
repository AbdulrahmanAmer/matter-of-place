import type { Market } from "../domain/market";
import { fill, t } from "./strings";

// Pure helpers behind the coming-soon block (B3b). A market is open when `comingSoon` is false; a collection is
// empty when it has no visible property, whatever the flag says.

export type ComingSoonScope = "home" | "properties" | "stories" | "market" | "region";

type MarketRef = Pick<Market, "name" | "slug" | "interestCopy">;
type RegionRef = Pick<Market["regions"][number], "name" | "slug">;

export function isComingSoon(market: Pick<Market, "comingSoon">): boolean {
  return market.comingSoon;
}

export function openMarkets<T extends Pick<Market, "comingSoon">>(markets: readonly T[]): T[] {
  return markets.filter((market) => !isComingSoon(market));
}

export function hasListings(properties: readonly unknown[]): boolean {
  return properties.length > 0;
}

/** The `subscribers.source` of an interest signup: `interest:home`, `interest:<market>`, `interest:<market>/<region>`. */
export function interestSource(
  scope: ComingSoonScope,
  market?: Pick<MarketRef, "slug">,
  region?: Pick<RegionRef, "slug">,
): string {
  if (scope === "market" && market !== undefined) return `interest:${market.slug}`;
  if (scope === "region" && market !== undefined && region !== undefined) {
    return `interest:${market.slug}/${region.slug}`;
  }
  return `interest:${scope}`;
}

/** The paragraph of a scope: the editors' own words for a market when set (B7 screen 15), else the table string. */
export function comingSoonText(scope: ComingSoonScope, market?: MarketRef, region?: RegionRef) {
  if (scope === "market" || scope === "region") {
    const own = market?.interestCopy;
    if (own !== undefined && own !== "") return own;
  }
  return fill(t.comingSoon[scope].text, { market: market?.name, region: region?.name });
}
