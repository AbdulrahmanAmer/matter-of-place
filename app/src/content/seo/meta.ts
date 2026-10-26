import type { SeoPageMeta } from "./types.ts";

/**
 * The light list of the search pages: the address, the kind, the headline and the description of each, in the order
 * the `/guides` index shows them. Nothing here carries copy, so a screen that only names the pages (the `/guides`
 * index, the links of a page) loads this and not the pages. A page's line is repeated from its content file, and
 * `tests/unit/seo-pages.test.ts` fails when the two differ.
 */
export const seoPageMeta: readonly SeoPageMeta[] = [
  {
    path: "/historic-homes-for-sale",
    kind: "collection",
    h1: "Historic Homes for Sale",
    description:
      "What makes a home historic, what owners and buyers should know, and how Matter of Place features historic homes in California, New York and Florida.",
  },
  {
    path: "/architect-designed-homes-for-sale",
    kind: "collection",
    h1: "Architect Designed Homes for Sale",
    description:
      "What architect designed homes are, how to read their record, and how Matter of Place features them in California, New York and Florida.",
  },
  {
    path: "/design-focused-homes-for-sale-newsletter",
    kind: "collection",
    h1: "Design Focused Homes for Sale Newsletter",
    description:
      "Place Notes is the Matter of Place newsletter: selected homes and stories chosen for design in California, New York and Florida.",
  },
  {
    path: "/frank-lloyd-wright-homes",
    kind: "collection",
    h1: "Frank Lloyd Wright Homes",
    description:
      "How to tell a Frank Lloyd Wright house from one in his manner, what owners and buyers should ask, and how Matter of Place features such homes.",
  },
  {
    path: "/historic-homes-for-sale-hudson-valley",
    kind: "collection",
    h1: "Historic Homes for Sale in Hudson Valley",
    description:
      "What historic means for a Hudson Valley house, what owners and buyers should know, and how Matter of Place features historic homes in New York.",
  },
  {
    path: "/hudson-valley-stone-houses-for-sale",
    kind: "collection",
    h1: "Stone Houses for Sale in Hudson Valley",
    description:
      "What a Hudson Valley stone house is, what owners and buyers should ask about the masonry, and how Matter of Place features stone houses in New York.",
  },
  {
    path: "/mid-century-modern-homes",
    kind: "collection",
    h1: "Mid-Century Modern Homes",
    description:
      "What marks a mid-century modern home, what owners and buyers should ask, and how Matter of Place features these homes in California, New York and Florida.",
  },
  {
    path: "/modern-homes-for-sale-south-florida",
    kind: "collection",
    h1: "Modern Homes for Sale in South Florida",
    description:
      "What a modern house in South Florida is, what owners and buyers should ask about climate and water, and how Matter of Place features such homes.",
  },
  {
    path: "/modernist-homes-for-sale-california",
    kind: "collection",
    h1: "Modernist Homes for Sale in California",
    description:
      "A guide to modernist homes in California: what the word covers, what owners and buyers should ask, and how Matter of Place features these houses.",
  },
  {
    path: "/richard-neutra-homes-for-sale",
    kind: "collection",
    h1: "Richard Neutra Homes for Sale",
    description:
      "What marks a house by Richard Neutra, what owners and buyers should check, and how Matter of Place features such homes.",
  },
  {
    path: "/submit-a-home-for-sale-to-be-featured",
    kind: "collection",
    h1: "Submit a Home for Sale to Be Featured",
    description:
      "How to submit a home to be featured by Matter of Place: what to send, how editorial review works, and what happens after acceptance in CA, NY and FL.",
  },
  {
    path: "/guides/how-to-sell-a-historic-home",
    kind: "guide",
    h1: "How to Sell a Historic Home?",
    description:
      "How to sell a historic home: find out what applies to it, gather the record, disclose what you know and tell its story with sources.",
  },
  {
    path: "/guides/editorial-real-estate-marketing",
    kind: "guide",
    h1: "Editorial Real Estate Marketing",
    description:
      "Editorial real estate marketing presents a home as a story to read, not an ad to scan. What it is, how it works and what it cannot do.",
  },
  {
    path: "/guides/house-of-the-day",
    kind: "guide",
    h1: "House of the Day",
    description:
      "House of the day: what the recurring home feature is, how editors choose a home, how to prepare one for consideration, and how Matter of Place differs.",
  },
  {
    path: "/guides/how-much-does-it-cost-to-advertise-a-luxury-listing",
    kind: "guide",
    h1: "How Much Does It Cost to Advertise a Luxury Listing?",
    description:
      "How much does it cost to advertise a luxury listing? What sets the spend, how to budget in order, and what Matter of Place charges, in plain words.",
  },
  {
    path: "/guides/how-to-market-a-luxury-listing",
    kind: "guide",
    h1: "How to Market a Luxury Listing?",
    description:
      "How to market a luxury listing: price it with care, show it honestly, tell its story with facts and choose a few channels that suit the home.",
  },
  {
    path: "/guides/how-to-sell-an-architecturally-significant-home",
    kind: "guide",
    h1: "How to Sell an Architecturally Significant Home?",
    description:
      "How to sell an architecturally significant home: prove the attribution, show what is original, price with care and present it to the right readers.",
  },
  {
    path: "/guides/is-a-sponsored-real-estate-feature-worth-it",
    kind: "guide",
    h1: "Is a Sponsored Real Estate Feature Worth It?",
    description:
      "Is a sponsored real estate feature worth it? It depends on the home, the readers and the terms. How to judge one, and what Matter of Place does.",
  },
  {
    path: "/guides/luxury-real-estate-marketing",
    kind: "guide",
    h1: "Luxury Real Estate Marketing",
    description:
      "Luxury real estate marketing, plainly: know the property and its buyer, build a true record, choose few channels well and review what each one does.",
  },
  {
    path: "/guides/luxury-real-estate-marketing-packages",
    kind: "guide",
    h1: "Luxury Real Estate Marketing Packages",
    description:
      "Luxury real estate marketing packages: what one should list, what to ask a provider, and the four plans Matter of Place offers for editorial exposure.",
  },
  {
    path: "/guides/real-estate-marketing",
    kind: "guide",
    h1: "Real Estate Marketing",
    description:
      "Real estate marketing in plain words: what a home needs before it is shown, the order of the work, the usual mistakes and where editorial fits.",
  },
  {
    path: "/guides/sponsored-real-estate-listing",
    kind: "guide",
    h1: "Sponsored Real Estate Listing",
    description:
      "A sponsored real estate listing is a listing promoted for a fee. What it is, how it should be labeled, what to ask and how an editorial feature differs.",
  },
  {
    path: "/guides/where-to-advertise-luxury-listings",
    kind: "guide",
    h1: "Where to Advertise Luxury Listings?",
    description:
      "Where to advertise luxury listings: start where buyers' agents look, add a place that suits the home, then paid media aimed at the likeliest buyer.",
  },
];

/** The addresses of the pages above. */
export const seoPagePaths: ReadonlySet<string> = new Set(seoPageMeta.map((page) => page.path));
