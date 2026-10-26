import { architectDesignedHomesForSale } from "./architect-designed-homes-for-sale.ts";
import { designFocusedHomesForSaleNewsletter } from "./design-focused-homes-for-sale-newsletter.ts";
import { frankLloydWrightHomes } from "./frank-lloyd-wright-homes.ts";
import { editorialRealEstateMarketing } from "./guides-editorial-real-estate-marketing.ts";
import { houseOfTheDay } from "./guides-house-of-the-day.ts";
import { howMuchDoesItCostToAdvertiseALuxuryListing } from "./guides-how-much-does-it-cost-to-advertise-a-luxury-listing.ts";
import { howToMarketALuxuryListing } from "./guides-how-to-market-a-luxury-listing.ts";
import { howToSellAHistoricHome } from "./guides-how-to-sell-a-historic-home.ts";
import { howToSellAnArchitecturallySignificantHome } from "./guides-how-to-sell-an-architecturally-significant-home.ts";
import { isASponsoredRealEstateFeatureWorthIt } from "./guides-is-a-sponsored-real-estate-feature-worth-it.ts";
import { luxuryRealEstateMarketingPackages } from "./guides-luxury-real-estate-marketing-packages.ts";
import { luxuryRealEstateMarketing } from "./guides-luxury-real-estate-marketing.ts";
import { realEstateMarketing } from "./guides-real-estate-marketing.ts";
import { sponsoredRealEstateListing } from "./guides-sponsored-real-estate-listing.ts";
import { whereToAdvertiseLuxuryListings } from "./guides-where-to-advertise-luxury-listings.ts";
import { historicHomesForSaleHudsonValley } from "./historic-homes-for-sale-hudson-valley.ts";
import { historicHomesForSale } from "./historic-homes-for-sale.ts";
import { hudsonValleyStoneHousesForSale } from "./hudson-valley-stone-houses-for-sale.ts";
import { midCenturyModernHomes } from "./mid-century-modern-homes.ts";
import { modernHomesForSaleSouthFlorida } from "./modern-homes-for-sale-south-florida.ts";
import { modernistHomesForSaleCalifornia } from "./modernist-homes-for-sale-california.ts";
import { richardNeutraHomesForSale } from "./richard-neutra-homes-for-sale.ts";
import { submitAHomeForSaleToBeFeatured } from "./submit-a-home-for-sale-to-be-featured.ts";
import type { SeoPageContent } from "./types.ts";

/**
 * Every search page, one line each. A writer adds a page here after adding its content file. The order is the order
 * the `/guides` index lists them in. Pages are static content: no loader reads a table for them (architecture 13).
 */
export const seoPages: readonly SeoPageContent[] = [
  historicHomesForSale,
  architectDesignedHomesForSale,
  designFocusedHomesForSaleNewsletter,
  frankLloydWrightHomes,
  historicHomesForSaleHudsonValley,
  hudsonValleyStoneHousesForSale,
  midCenturyModernHomes,
  modernHomesForSaleSouthFlorida,
  modernistHomesForSaleCalifornia,
  richardNeutraHomesForSale,
  submitAHomeForSaleToBeFeatured,
  howToSellAHistoricHome,
  editorialRealEstateMarketing,
  houseOfTheDay,
  howMuchDoesItCostToAdvertiseALuxuryListing,
  howToMarketALuxuryListing,
  howToSellAnArchitecturallySignificantHome,
  isASponsoredRealEstateFeatureWorthIt,
  luxuryRealEstateMarketing,
  luxuryRealEstateMarketingPackages,
  realEstateMarketing,
  sponsoredRealEstateListing,
  whereToAdvertiseLuxuryListings,
];

/** The page served at `path` (no trailing slash), or undefined when none is. */
export function seoPageAt(path: string): SeoPageContent | undefined {
  return seoPages.find((page) => page.path === path);
}

/** The page a route file serves: a missing one is a coding error, so the module fails to load instead of answering 404. */
export function requireSeoPage(path: string): SeoPageContent {
  const page = seoPageAt(path);
  if (page === undefined) throw new Error(`no page in src/content/seo serves ${path}`);
  return page;
}

/** The article guide at `/guides/<slug>`, or undefined. */
export function guidePageAt(slug: string): SeoPageContent | undefined {
  const page = seoPageAt(`/guides/${slug}`);
  return page?.kind === "guide" ? page : undefined;
}
