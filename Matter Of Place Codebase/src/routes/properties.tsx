import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { FilterBar } from "../components/filters/filter-bar";
import { HomeFinder } from "../components/search/home-finder";
import { PageIntro } from "../components/site/page-intro";
import { PropertyGrid } from "../components/site/property-card";
import { SectionHeading } from "../components/site/section-heading";
import { applyFilters, useFilters } from "../hooks/use-filters";
import { track } from "../lib/analytics";
import { pluralize } from "../lib/format";
import { marketsQuery, propertiesQuery } from "../lib/queries";
import { pageHead } from "../lib/seo";

const description =
  "A quiet selection of places with something to say: residences across California, Florida and New York, searchable by place, price, type and architecture.";

export const Route = createFileRoute("/properties")({
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
  head: () => pageHead({ title: "Properties", description, path: "/properties" }),
  component: PropertiesPage,
});

function PropertiesPage() {
  const { properties, markets } = Route.useLoaderData();
  const { q } = Route.useSearch();
  const filterState = useFilters({ term: q ?? "" });
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

  return (
    <main>
      <PageIntro
        eyebrow="A CONSIDERED COLLECTION"
        title="Properties"
        text="A quiet selection of places with something to say. Every property shown is illustrative."
      />
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
              Filter {active > 0 ? `(${active})` : ""} {showFilters ? "−" : "+"}
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
