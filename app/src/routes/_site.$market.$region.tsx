import { createFileRoute, Link, notFound, redirect } from "@tanstack/react-router";
import { FilteredCollection } from "../components/filters/collection";
import { ComingSoon } from "../components/site/coming-soon";
import { IllustrativeNotice } from "../components/site/illustrative-notice";
import { ImageHero } from "../components/site/image-hero";
import { PageIntro } from "../components/site/page-intro";
import { PropertyGrid } from "../components/site/property-card";
import { SectionHeading } from "../components/site/section-heading";
import { TextLink } from "../components/site/text-link";
import { applyFilters, useFilters } from "../hooks/use-filters";
import { useTrackView } from "../hooks/use-track-view";
import { propertiesIn } from "../lib/catalog";
import { marketQuery, propertiesQuery } from "../lib/queries";
import { pageHead, unavailableHead } from "../lib/seo";
import { fill, t } from "../lib/strings";

/** Region slugs renamed to match their display names. */
const legacyRegions: Record<string, string> = {
  "san-diego": "la-jolla",
  "south-florida": "fort-lauderdale",
};

export const Route = createFileRoute("/_site/$market/$region")({
  beforeLoad: ({ params }) => {
    const renamed = legacyRegions[params.region];
    if (renamed)
      throw redirect({
        to: "/$market/$region",
        params: { ...params, region: renamed },
        statusCode: 301,
      });
  },
  loader: async ({ params, context: { queryClient } }) => {
    const [market, properties] = await Promise.all([
      queryClient.ensureQueryData(marketQuery(params.market)),
      queryClient.ensureQueryData(propertiesQuery()),
    ]);
    const region = market?.regions.find((item) => item.slug === params.region);
    if (!market || !region) throw notFound();
    return {
      market,
      region,
      pool: propertiesIn(properties, market.slug, region.slug),
      elsewhere: propertiesIn(properties, market.slug)
        .filter((property) => property.region !== region.slug)
        .slice(0, 2),
    };
  },
  head: ({ loaderData }) => {
    if (!loaderData) return unavailableHead("Region");
    const { market, region, pool } = loaderData;
    const title = `${region.name}, ${market.name}`;
    const path = `/${market.slug}/${region.slug}`;
    if (pool.length === 0) {
      return pageHead({
        title,
        description: fill(t.comingSoon.meta.market, { intro: region.intro, market: region.name }),
        path,
        noindex: true,
      });
    }
    return pageHead({
      title,
      description: `${region.intro} Properties in ${region.places.join(", ")}.`,
      path,
    });
  },
  component: RegionPage,
});

const listPlaces = (places: string[]) => {
  const last = places.at(-1);
  return last !== undefined && places.length > 1
    ? `${places.slice(0, -1).join(", ")} and ${last}`
    : (places[0] ?? "");
};

function RegionPage() {
  const { market, region, pool, elsewhere } = Route.useLoaderData();
  const filterState = useFilters();
  useTrackView("region_view", `${market.slug}/${region.slug}`, {
    market: market.name,
    region: region.name,
  });

  const items = applyFilters(pool, filterState.filters);
  const locations = Array.from(new Set(pool.map((property) => property.neighborhood))).map(
    (neighborhood) => ({ value: neighborhood, label: neighborhood }),
  );

  return (
    <main>
      {market.comingSoon || region.image === undefined ? (
        <PageIntro
          eyebrow={`${market.name.toUpperCase()}, ${market.country.toUpperCase()}`}
          title={region.name}
        />
      ) : (
        <ImageHero
          image={region.image}
          alt={`Architecture in ${region.name}`}
          eyebrow={`${market.name.toUpperCase()}, ${market.country.toUpperCase()}`}
          title={region.name}
        />
      )}
      <IllustrativeNotice properties={[...pool, ...elsewhere]} />

      <section className="section-wrap editorial-statement">
        <p className="eyebrow">THE PLACE</p>
        <div>
          <h2>{region.intro}</h2>
          <p>
            Part of the {market.name} market. We follow {listPlaces(region.places)}.
          </p>
          <div className="region-places" aria-label="Places within this region">
            {region.places.map((place) => (
              <span key={place}>{place}</span>
            ))}
          </div>
        </div>
      </section>

      {pool.length === 0 ? (
        <ComingSoon scope="region" market={market} region={region} />
      ) : (
        <FilteredCollection
          eyebrow="REGION COLLECTION"
          title={`Properties in ${region.name}`}
          state={filterState}
          pool={pool}
          items={items}
          locations={locations}
          filtersId="region-filters"
          tabs={
            <>
              <Link to="/$market" params={{ market: market.slug }}>
                All
              </Link>
              {market.regions.map((item) => (
                <Link
                  key={item.slug}
                  to="/$market/$region"
                  params={{ market: market.slug, region: item.slug }}
                  className={item.slug === region.slug ? "selected" : ""}
                >
                  {item.name}
                </Link>
              ))}
            </>
          }
          emptyAction={
            <TextLink to="/$market" params={{ market: market.slug }}>
              See all of {market.name}
            </TextLink>
          }
        />
      )}

      {elsewhere.length > 0 && (
        <section className="section-wrap featured related-properties">
          <SectionHeading
            eyebrow={`ELSEWHERE IN ${market.name.toUpperCase()}`}
            title={`Beyond ${region.name}`}
            action={
              <TextLink to="/$market" params={{ market: market.slug }}>
                All of {market.name}
              </TextLink>
            }
          />
          <PropertyGrid items={elsewhere} />
        </section>
      )}
    </main>
  );
}
