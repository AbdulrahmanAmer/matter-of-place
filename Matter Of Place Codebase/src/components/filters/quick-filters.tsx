import type { Property } from "../../domain/property";
import type { FilterState } from "../../hooks/use-filters";
import { featuresOf, stylesOf, typesOf } from "../../lib/catalog";

/** Three concise filters for market and region pages: type, architecture, design feature. */
export function QuickFilters({ state, pool }: { state: FilterState; pool: Property[] }) {
  const { filters, set, reset, active } = state;
  return (
    <div className="quick-filters">
      <select
        aria-label="Property type"
        value={filters.type}
        onChange={(e) => set("type", e.target.value)}
      >
        <option value="">Type</option>
        {typesOf(pool).map((type) => (
          <option key={type}>{type}</option>
        ))}
      </select>
      <select
        aria-label="Architecture"
        value={filters.style}
        onChange={(e) => set("style", e.target.value)}
      >
        <option value="">Architecture</option>
        {stylesOf(pool).map((style) => (
          <option key={style}>{style}</option>
        ))}
      </select>
      <select
        aria-label="Design feature"
        value={filters.feature}
        onChange={(e) => set("feature", e.target.value)}
      >
        <option value="">Features</option>
        {featuresOf(pool).map((feature) => (
          <option key={feature}>{feature}</option>
        ))}
      </select>
      {active > 0 && (
        <button type="button" className="filter-clear" onClick={reset}>
          Clear
        </button>
      )}
    </div>
  );
}
