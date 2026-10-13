import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { FilteredCollection } from "../components/filters/collection";
import { ComingSoon } from "../components/site/coming-soon";
import { StoryGrid } from "../components/site/story-card";
import { PropertyGrid } from "../components/site/property-card";
import { IllustrativeNotice } from "../components/site/illustrative-notice";
import { ImageHero } from "../components/site/image-hero";
import { PageIntro } from "../components/site/page-intro";
import { SectionHeading } from "../components/site/section-heading";
import { TextLink } from "../components/site/text-link";
import { applyFilters, useFilters } from "../hooks/use-filters";
import { useTrackView } from "../hooks/use-track-view";
import { propertiesIn } from "../lib/catalog";
import { pluralize } from "../lib/format";
import { marketQuery, propertiesQuery, storiesQuery } from "../lib/queries";
import { breadcrumbLd, collectionLd } from "../lib/jsonld";
import { ogImageFor, ogStaticOf } from "../lib/og";
import { indexable, pageHead, unavailableHead } from "../lib/seo";
import { marketDescription } from "../lib/seo-copy";
import { fill, t } from "../lib/strings";

export const Route = createFileRoute("/_site/$market/")({
  loader: async ({ params, context: { queryClient } }) => {
    const [market, properties, stories] = await Promise.all([
      queryClient.query({ ...marketQuery(params.market), staleTime: "static" }),
      queryClient.query({ ...propertiesQuery(), staleTime: "static" }),
      queryClient.query({ ...storiesQuery(), staleTime: "static" }),
    ]);
    if (!market) throw notFound();
    const pool = propertiesIn(properties, market.slug);
    return {
      market,
      pool,
      recent: [...pool].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)).slice(0, 2),
      stories: stories.filter((story) => story.market === market.slug).slice(0, 3),
    };
  },
  head: ({ loaderData, matches }) => {
    if (!loaderData) return unavailableHead("Market");
    const { market, pool } = loaderData;
    const intro = `${market.intro.split(".")[0] ?? market.intro}.`;
    if (pool.length === 0) {
      return pageHead({
        title: market.name,
        description: fill(t.comingSoon.meta.market, { intro, market: market.name }),
        path: `/${market.slug}`,
        image: ogImageFor({ key: `market-${market.slug}`, ogStatic: ogStaticOf(matches) }),
        ...indexable(pool.length),
      });
    }
    return pageHead({
      title: market.name,
      description: marketDescription(market),
      path: `/${market.slug}`,
      image: ogImageFor({ key: `market-${market.slug}`, ogStatic: ogStaticOf(matches) }),
      jsonLd: [
        collectionLd(
          "market",
          market.name,
          `/${market.slug}`,
          pool.map((property) => ({ name: property.title, path: `/property/${property.slug}` })),
        ),
        breadcrumbLd([
          { name: "Markets", path: "/markets" },
          { name: market.name, path: `/${market.slug}` },
        ]),
      ],
    });
  },
  component: MarketPage,
});

function MarketPage() {
  const { market, pool, recent, stories } = Route.useLoaderData();
  const filterState = useFilters();
  useTrackView("market_view", market.slug, { market: market.name });

  const items = applyFilters(pool, filterState.filters);
  const locations = market.regions
    .filter((region) => pool.some((property) => property.region === region.slug))
    .map((region) => ({ value: region.slug, label: region.name }));

  return (
    <main>
      {pool.length === 0 ? (
        <section className="hero-text market-hero-empty" aria-labelledby="market-title">
          <div className="section-wrap hero-text-inner">
            <p className="eyebrow">MATTER OF PLACE · EDITORIAL DESK</p>
            <h1 id="market-title">{market.name}</h1>
            <p className="hero-text-lede">{market.intro}</p>
            <p className="market-hero-status">
              <span aria-hidden="true" className="market-hero-dot" />
              Opening soon. The first {market.name} properties are being considered.
            </p>
            <div className="hero-text-actions">
              <a href="#market-signup" className="button">
                Hear when it opens
              </a>
              <Link to="/submit" className="button ghost">
                Submit a Property
              </Link>
            </div>
          </div>
        </section>
      ) : market.comingSoon || market.image === undefined ? (
        <PageIntro eyebrow="MATTER OF PLACE · EDITORIAL DESK" title={market.name} />
      ) : (
        <ImageHero
          image={market.image}
          alt={market.name}
          eyebrow="MATTER OF PLACE · EDITORIAL DESK"
          title={market.name}
        />
      )}
      <IllustrativeNotice properties={pool} />

      <section className="section-wrap editorial-statement">
        <p className="eyebrow">THE PLACE</p>
        <div>
          <h2>Setting first.</h2>
          {pool.length > 0 && <p>{market.intro}</p>}
          <div className="market-places">
            <p className="eyebrow">PLACES WE FOLLOW</p>
            <p>{market.places.join(" · ")}</p>
          </div>
        </div>
      </section>

      <section className="section-wrap market-notes" aria-label={`Reading ${market.name}`}>
        <p className="eyebrow">HOW WE READ {market.name.toUpperCase()}</p>
        <dl>
          {market.notes.map((note) => (
            <div key={note.label}>
              <dt>{note.label}</dt>
              <dd>{note.text}</dd>
            </div>
          ))}
        </dl>
        <TextLink to="/$market/guide" params={{ market: market.slug }} className="guide-cta">
          Read the {market.name} guide
        </TextLink>
      </section>

      <section className="section-wrap market-regions" aria-labelledby="regions-heading">
        <SectionHeading eyebrow="REGIONS" title={`Within ${market.name}`} id="regions-heading" />
        <div className="market-regions-grid">
          {market.regions.map((region) => {
            const count = pool.filter((property) => property.region === region.slug).length;
            return (
              <Link
                key={region.slug}
                to="/$market/$region"
                params={{ market: market.slug, region: region.slug }}
                className="market-region-card"
              >
                <span className="eyebrow">
                  {pool.length === 0
                    ? "OPENING SOON"
                    : `${String(count)} ${pluralize(count, "PROPERTY", "PROPERTIES")}`}
                </span>
                <h3>{region.name}</h3>
                <p>{region.places.join(" · ")}</p>
              </Link>
            );
          })}
        </div>
      </section>

      {pool.length === 0 ? (
        <div id="market-signup" className="market-signup">
          <ComingSoon scope="market" market={market} />
        </div>
      ) : (
        <FilteredCollection
          eyebrow="EXPLORE THE MARKET"
          title="Selected properties"
          state={filterState}
          pool={pool}
          items={items}
          locations={locations}
          filtersId="market-filters"
          tabs={
            <>
              <Link to="/$market" params={{ market: market.slug }} className="selected">
                All
              </Link>
              {market.regions.map((region) => (
                <Link
                  key={region.slug}
                  to="/$market/$region"
                  params={{ market: market.slug, region: region.slug }}
                >
                  {region.name}
                </Link>
              ))}
            </>
          }
        />
      )}

      {recent.length > 0 && (
        <section className="section-wrap featured related-properties">
          <SectionHeading eyebrow="RECENT ADDITIONS" title={`New to ${market.name}`} />
          <PropertyGrid items={recent} />
        </section>
      )}

      {stories.length > 0 && (
        <section className="section-wrap featured">
          <SectionHeading
            eyebrow="FROM THE DESK"
            title={`Stories from ${market.name}`}
            action={<TextLink to="/stories">All stories</TextLink>}
          />
          <StoryGrid items={stories} />
        </section>
      )}
    </main>
  );
}
