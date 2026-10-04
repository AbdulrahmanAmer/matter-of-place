import type { CatalogRows } from "../public/mappers.ts";
import type { PublicState } from "../public/state.ts";

export interface VisibilityContext {
  state: PublicState;
  env: { MOP_ENV: string };
}

/**
 * The one place a row is hidden from the public (invariant 5). `getCatalog` calls it once per catalog
 * version on the mapped rows, never per request. It only filters rows: `Market.comingSoon` is set by the mapper.
 */
export function applyVisibility<T extends CatalogRows>(rows: T, ctx: VisibilityContext): T {
  const { state, env } = ctx;
  // A missing or unknown environment already reads as false in `public_state()`; production is forced here too.
  const showIllustrative = state.illustrativeContent && env.MOP_ENV !== "production";
  const isOpen = (market: string) =>
    !state.comingSoonGlobal && state.comingSoonMarkets[market] !== true;
  return {
    ...rows,
    properties: rows.properties.filter(
      (property) =>
        isOpen(property.market) && (showIllustrative || property.status !== "Illustrative"),
    ),
  };
}
