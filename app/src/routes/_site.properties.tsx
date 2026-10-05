import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { FilterBar } from "../components/filters/filter-bar";
import { HomeFinder } from "../components/search/home-finder";
import { ComingSoon } from "../components/site/coming-soon";
import { IllustrativeNotice } from "../components/site/illustrative-notice";
import { PageIntro } from "../components/site/page-intro";
import { PropertyGrid } from "../components/site/property-card";
import { SectionHeading } from "../components/site/section-heading";
import { applyFilters, useFilters } from "../hooks/use-filters";
import { track } from "../lib/analytics";
import { pluralize } from "../lib/format";
import { marketsQuery, propertiesQuery } from "../lib/queries";
import { breadcrumbLd, collectionLd } from "../lib/jsonld";
import { pageHead } from "../lib/seo";
import { pageDescription } from "../lib/seo-copy";
import { t } from "../lib/strings";

export const Route = createFileRoute("/_site/properties")({
  validateSearch: (search: Record<string, unknown>): { q?: string } => {
    const q = search["q"];
    return typeof q === "string" && q.trim() ? { q } : {};
  },
  loader: async ({ context: { queryClient } }) => {
    const [properties, markets] = await Promise.all([
      queryClient.ensureQueryData(propertiesQuery()),
      queryClient.ensureQueryData(marketsQuery()),
    ]);
    return { properties, markets };
  },
  head: ({ loaderData }) =>
    loaderData?.properties.length === 0
      ? pageHead({
          title: "Properties",
          description: t.comingSoon.meta.properties,
          path: "/properties",
          noindex: true,
        })
      : pageHead({
          title: "Properties",
          description: pageDescription("properties"),
          path: "/properties",
          jsonLd: [
            collectionLd(
              "properties",
              "Properties",
              "/properties",
              (loaderData?.properties ?? []).map((property) => ({
                name: property.title,
                path: `/property/${property.slug}`,
              })),
            ),
            breadcrumbLd([{ name: "Properties", path: "/properties" }]),
          ],
        }),
  component: PropertiesPage,
});

function PropertiesPage() {
  const { properties, markets } = Route.useLoaderData();
  const { q } = Route.useSearch();
  // The server render ignores `q`: the page is stored once under the `/properties` key, so the
  // effect below applies the term after hydration.
  const filterState = useFilters();
  const [showFilters, setShowFilters] = useState(false);
  const { filters, set, reset, active } = filterState;

  // The header search navigates here with `?q=`; keep the field in step with the URL.
  useEffect(() => {
    set("term", q ?? "");
    if (q) track("search", { q });
  }, [q, set]);

  const items = applyFilters(properties, filters);
  const locations = markets.flatMap((market) =>
    market.regions.map((region) => ({ value: region.slug, label: region.name })),
  );

  const illustrative = properties.some((property) => property.status === "Illustrative");
  const intro = (
    <PageIntro
      eyebrow="A CONSIDERED COLLECTION"
      title="Properties"
      text={`A quiet selection of places with something to say.${illustrative ? " Every property shown is illustrative." : ""}`}
    />
  );

  if (properties.length === 0) {
    return (
      <main>
        {intro}
        <ComingSoon scope="properties" />
      </main>
    );
  }

  return (
    <main>
      {intro}
      <IllustrativeNotice properties={properties} />
      <div className="section-wrap">
        <HomeFinder />
      </div>
      <section className="section-wrap collection">
        <SectionHeading
          eyebrow={
            filters.term
              ? `SEARCHING “${filters.term.toUpperCase()}”`
              : "CALIFORNIA · FLORIDA · NEW YORK"
          }
          title={items.length === properties.length ? "All places" : "Your selection"}
          action={
            <button
              type="button"
              className="text-link"
              onClick={() => setShowFilters((open) => !open)}
              aria-expanded={showFilters}
              aria-controls="property-filters"
            >
              Filter {active > 0 ? `(${String(active)})` : ""} {showFilters ? "−" : "+"}
            </button>
          }
        />
        <div className="filter-bar filter-bar-search">
          <input
            aria-label="Search properties"
            placeholder="Search place, neighbourhood or property"
            value={filters.term}
            onChange={(e) => set("term", e.target.value)}
          />
          {filters.term && (
            <button type="button" className="filter-clear" onClick={() => set("term", "")}>
              Clear search
            </button>
          )}
        </div>
        {showFilters && (
          <div id="property-filters">
            <FilterBar
              state={filterState}
              pool={properties}
              markets={markets}
              locations={locations}
            />
          </div>
        )}
        <p className="result-count">
          {items.length} {pluralize(items.length, "PROPERTY", "PROPERTIES")}
        </p>
        {items.length ? (
          <PropertyGrid items={items} />
        ) : (
          <p className="collection-empty">
            No properties match.{" "}
            <button type="button" className="text-link" onClick={reset}>
              Clear filters
            </button>
          </p>
        )}
      </section>
    </main>
  );
}
