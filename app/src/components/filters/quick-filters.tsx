import type { Property } from "../../domain/property";
import type { FilterState } from "../../hooks/use-filters";
import { featuresOf, stylesOf, typesOf } from "../../lib/catalog";
import { FilterSelect } from "./filter-select";

/** Three concise filters for market and region pages: type, architecture, design feature. */
export function QuickFilters({ state, pool }: { state: FilterState; pool: Property[] }) {
  const { filters, set, reset, active } = state;
  return (
    <div className="quick-filters">
      <FilterSelect
        label="Property type"
        anyLabel="Type"
        value={filters.type}
        options={typesOf(pool)}
        onChange={(value) => set("type", value)}
      />
      <FilterSelect
        label="Architecture"
        anyLabel="Architecture"
        value={filters.style}
        options={stylesOf(pool)}
        onChange={(value) => set("style", value)}
      />
      <FilterSelect
        label="Design feature"
        anyLabel="Features"
        value={filters.feature}
        options={featuresOf(pool)}
        onChange={(value) => set("feature", value)}
      />
      {active > 0 && (
        <button type="button" className="filter-clear" onClick={reset}>
          Clear
        </button>
      )}
    </div>
  );
}
