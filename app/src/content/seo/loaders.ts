import type { SeoPageContent } from "./types.ts";

/**
 * How to load one article guide by its slug. Each entry is a dynamic import, so the copy of a guide is a chunk of its own
 * that only `/guides/<slug>` fetches: no other route, and not the entry, holds it. A guide is listed here after
 * its content file is listed in `index.ts`; `tests/unit/seo-pages.test.ts` fails when the two lists differ.
 */
export const guideLoaders: ReadonlyMap<string, () => Promise<SeoPageContent>> = new Map([
  [
    "how-to-sell-a-historic-home",
    async () => (await import("./guides-how-to-sell-a-historic-home.ts")).howToSellAHistoricHome,
  ],
  [
    "editorial-real-estate-marketing",
    async () =>
      (await import("./guides-editorial-real-estate-marketing.ts")).editorialRealEstateMarketing,
  ],
  ["house-of-the-day", async () => (await import("./guides-house-of-the-day.ts")).houseOfTheDay],
  [
    "how-much-does-it-cost-to-advertise-a-luxury-listing",
    async () =>
      (await import("./guides-how-much-does-it-cost-to-advertise-a-luxury-listing.ts"))
        .howMuchDoesItCostToAdvertiseALuxuryListing,
  ],
  [
    "how-to-market-a-luxury-listing",
    async () =>
      (await import("./guides-how-to-market-a-luxury-listing.ts")).howToMarketALuxuryListing,
  ],
  [
    "how-to-sell-an-architecturally-significant-home",
    async () =>
      (await import("./guides-how-to-sell-an-architecturally-significant-home.ts"))
        .howToSellAnArchitecturallySignificantHome,
  ],
  [
    "is-a-sponsored-real-estate-feature-worth-it",
    async () =>
      (await import("./guides-is-a-sponsored-real-estate-feature-worth-it.ts"))
        .isASponsoredRealEstateFeatureWorthIt,
  ],
  [
    "luxury-real-estate-marketing",
    async () =>
      (await import("./guides-luxury-real-estate-marketing.ts")).luxuryRealEstateMarketing,
  ],
  [
    "luxury-real-estate-marketing-packages",
    async () =>
      (await import("./guides-luxury-real-estate-marketing-packages.ts"))
        .luxuryRealEstateMarketingPackages,
  ],
  [
    "real-estate-marketing",
    async () => (await import("./guides-real-estate-marketing.ts")).realEstateMarketing,
  ],
  [
    "sponsored-real-estate-listing",
    async () =>
      (await import("./guides-sponsored-real-estate-listing.ts")).sponsoredRealEstateListing,
  ],
  [
    "where-to-advertise-luxury-listings",
    async () =>
      (await import("./guides-where-to-advertise-luxury-listings.ts"))
        .whereToAdvertiseLuxuryListings,
  ],
]);
