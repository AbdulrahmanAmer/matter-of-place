import type { CatalogRows } from "../public/mappers.ts";
import type { PublicState } from "../public/state.ts";

export interface VisibilityContext {
  state: PublicState;
  env: { MOP_ENV: string };
}

/**
 * The one place a row is hidden from the public (invariant 5). `getCatalog` calls it once per catalog
 * version on the mapped rows, never per request.
 */
// STUB(B3b step 4): coming-soon and illustrative filtering
export function applyVisibility<T extends CatalogRows>(rows: T, _ctx: VisibilityContext): T {
  return rows;
}
