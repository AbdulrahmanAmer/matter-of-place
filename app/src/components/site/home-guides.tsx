import { TextLink } from "./text-link";

type GuideLink = readonly [path: string, anchor: string];

// The addresses and anchors of the guides the home page names. Kept here as plain strings, not read from
// `content/seo`, so the home route's entry chunk carries no page copy. `tests/unit/home-guides.test.tsx` checks each
// path against `content/seo/meta.ts`.
const kindsOfHome: readonly GuideLink[] = [
  ["/mid-century-modern-homes", "mid-century modern homes"],
  ["/historic-homes-for-sale", "historic homes for sale"],
  ["/frank-lloyd-wright-homes", "frank lloyd wright homes"],
  ["/architect-designed-homes-for-sale", "architect designed homes for sale"],
  ["/hudson-valley-stone-houses-for-sale", "hudson valley stone houses for sale"],
  ["/modern-homes-for-sale-south-florida", "modern homes for sale south florida"],
  ["/modernist-homes-for-sale-california", "modernist homes for sale california"],
  ["/richard-neutra-homes-for-sale", "richard neutra homes for sale"],
  ["/design-focused-homes-for-sale-newsletter", "design focused homes for sale newsletter"],
];

const forOwnersAndAgents: readonly GuideLink[] = [
  ["/submit-a-home-for-sale-to-be-featured", "submit a home for sale to be featured"],
  ["/guides/real-estate-marketing", "real estate marketing"],
  [
    "/guides/is-a-sponsored-real-estate-feature-worth-it",
    "is a sponsored real estate feature worth it",
  ],
  ["/guides/house-of-the-day", "house of the day"],
  ["/guides/how-to-market-a-luxury-listing", "how to market a luxury listing"],
  ["/guides/how-to-sell-a-historic-home", "how to sell a historic home"],
  [
    "/guides/how-to-sell-an-architecturally-significant-home",
    "how to sell an architecturally significant home",
  ],
  ["/guides/sponsored-real-estate-listing", "sponsored real estate listing"],
  ["/guides/where-to-advertise-luxury-listings", "where to advertise luxury listings"],
];

function GuideList({ heading, links }: { heading: string; links: readonly GuideLink[] }) {
  return (
    <div>
      <h3 className="eyebrow">{heading}</h3>
      <ul>
        {links.map(([path, anchor]) => (
          <li key={path}>
            <a href={path}>{anchor}</a>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A quiet list of the guides near the foot of the home page: two plain link lists and the way to the rest. */
export function HomeGuides() {
  return (
    <section className="section-wrap home-guides" aria-labelledby="guides-heading">
      <p className="eyebrow">GUIDES</p>
      <h2 id="guides-heading">Plain writing on the homes we follow.</h2>
      <div className="home-guides-lists">
        <GuideList heading="Kinds of home" links={kindsOfHome} />
        <GuideList heading="For owners and agents" links={forOwnersAndAgents} />
      </div>
      <TextLink to="/guides">All guides</TextLink>
    </section>
  );
}
