import { useState, type ReactNode } from "react";
import type { Property } from "../../domain/property";
import type { FilterState } from "../../hooks/use-filters";
import { pluralize } from "../../lib/format";
import { PropertyGrid } from "../site/property-card";
import { SectionHeading } from "../site/section-heading";
import { FilterBar, type LocationOption } from "./filter-bar";
import { QuickFilters } from "./quick-filters";

/**
 * Filtered collection used by market and region pages: heading, region tabs,
 * quick filters, an expandable full filter row, count and grid.
 */
export function FilteredCollection({
  eyebrow,
  title,
  state,
  pool,
  items,
  locations,
  tabs,
  emptyAction,
  filtersId,
}: {
  eyebrow: string;
  title: string;
  state: FilterState;
  pool: Property[];
  items: Property[];
  locations: LocationOption[];
  tabs: ReactNode;
  /** Shown when nothing matches and no filter is active. */
  emptyAction?: ReactNode;
  filtersId: string;
}) {
  const [showFilters, setShowFilters] = useState(false);
  return (
    <section className="section-wrap collection">
      <SectionHeading
        eyebrow={eyebrow}
        title={title}
        action={
          <button
            type="button"
            className="text-link"
            onClick={() => setShowFilters((open) => !open)}
            aria-expanded={showFilters}
            aria-controls={filtersId}
          >
            More {showFilters ? "−" : "+"}
          </button>
        }
      />
      <div className="region-tabs">{tabs}</div>
      <QuickFilters state={state} pool={pool} />
      {showFilters && (
        <div id={filtersId}>
          <FilterBar state={state} pool={pool} locations={locations} />
        </div>
      )}
      <p className="result-count">
        {items.length} {pluralize(items.length, "PROPERTY", "PROPERTIES")}
      </p>
      {items.length ? (
        <PropertyGrid items={items} />
      ) : (
        <p className="collection-empty">
          Nothing here yet.{" "}
          {state.active > 0 ? (
            <button type="button" className="text-link" onClick={state.reset}>
              Clear filters
            </button>
          ) : (
            emptyAction
          )}
        </p>
      )}
    </section>
  );
}
