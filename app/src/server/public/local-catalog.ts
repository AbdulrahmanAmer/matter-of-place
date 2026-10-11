import type { Property } from "../../domain/property.ts";
import type { PublicState, ServedCatalog } from "./state.ts";

// The catalog of a local build, for the documents a Worker builds in process (the sitemap and the two llms files).
// After the launch switch the dev Worker and every preview run the local adapter and hold no Supabase key (H35 (7),
// P-3410); the pages already answer from the bundled content, so these documents must too, from the same adapter.

const localState: PublicState = {
  catalogVersion: 0,
  flags: {},
  comingSoonGlobal: false,
  comingSoonMarkets: {},
  site: {},
  // `localSite` says the same: the bundled content is illustrative and labelled (invariant 6).
  illustrativeContent: true,
  ogStatic: {},
  products: null,
};

const isProperty = (found: Property | { gone: true } | null): found is Property =>
  found !== null && !("gone" in found);

/**
 * The bundled catalog and a state that labels it illustrative, or undefined in a live build (`VITE_API_BASE_URL` set),
 * which drops the local adapters with the bundled content (FE-03).
 */
export async function readLocalCatalog(): Promise<
  { catalog: ServedCatalog; state: PublicState } | undefined
> {
  if (import.meta.env.VITE_API_BASE_URL) return undefined;
  const { localCatalog } = await import("../../services/local/catalog");
  const [cards, markets, stories] = await Promise.all([
    localCatalog.listProperties(),
    localCatalog.listMarkets(),
    localCatalog.listStories(),
  ]);
  const found = await Promise.all(cards.map(({ slug }) => localCatalog.getProperty(slug)));
  const properties = found.filter(isProperty);
  return {
    catalog: {
      version: localState.catalogVersion,
      properties,
      markets,
      stories,
      cards,
      redirects: [],
      slugHistory: [],
      gone: [],
    },
    state: localState,
  };
}
