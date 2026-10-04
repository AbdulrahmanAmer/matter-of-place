import type { Market } from "../../domain/market";
import type { PropertyCard } from "../../domain/property";
import type { FilterState } from "../../hooks/use-filters";
import { featuresOf, statusesOf, stylesOf, typesOf } from "../../lib/catalog";
import { FilterSelect } from "./filter-select";

export type LocationOption = { value: string; label: string };

const priceCeilings = [
  { value: "5000000", label: "Under $5M" },
  { value: "7000000", label: "Under $7M" },
  { value: "10000000", label: "Under $10M" },
  { value: "15000000", label: "Under $15M" },
];

const bedroomMinimums = ["4", "5", "6"];

/**
 * Full filter row. Options are derived from the properties on the page, so
 * the controls never offer a choice that returns nothing.
 */
export function FilterBar({
  state,
  pool,
  markets,
  locations,
  showSearch = false,
}: {
  state: FilterState;
  pool: PropertyCard[];
  /** When provided, a market select is shown. */
  markets?: Market[];
  locations?: LocationOption[];
  showSearch?: boolean;
}) {
  const { filters, set, reset, active } = state;
  const statuses = statusesOf(pool);
  return (
    <div className="filter-bar">
      {showSearch && (
        <input
          aria-label="Search properties"
          placeholder="Search place or property"
          value={filters.term}
          onChange={(e) => set("term", e.target.value)}
        />
      )}
      {markets && (
        <select
          aria-label="Market"
          value={filters.market}
          onChange={(e) => set("market", e.target.value)}
        >
          <option value="">All markets</option>
          {markets.map((market) => (
            <option key={market.slug} value={market.slug}>
              {market.name}
            </option>
          ))}
        </select>
      )}
      {locations && locations.length > 0 && (
        <select
          aria-label="Location"
          value={filters.location}
          onChange={(e) => set("location", e.target.value)}
        >
          <option value="">All locations</option>
          {locations.map((location) => (
            <option key={location.value} value={location.value}>
              {location.label}
            </option>
          ))}
        </select>
      )}
      <select
        aria-label="Maximum asking price"
        value={filters.max}
        onChange={(e) => set("max", e.target.value)}
      >
        <option value="">Any price</option>
        {priceCeilings.map((ceiling) => (
          <option key={ceiling.value} value={ceiling.value}>
            {ceiling.label}
          </option>
        ))}
      </select>
      <select
        aria-label="Property type"
        value={filters.type}
        onChange={(e) => set("type", e.target.value)}
      >
        <option value="">All types</option>
        {typesOf(pool).map((type) => (
          <option key={type}>{type}</option>
        ))}
      </select>
      <select
        aria-label="Bedrooms"
        value={filters.beds}
        onChange={(e) => set("beds", e.target.value)}
      >
        <option value="">Any bedrooms</option>
        {bedroomMinimums.map((beds) => (
          <option key={beds} value={beds}>
            {beds}+ bedrooms
          </option>
        ))}
      </select>
      <FilterSelect
        label="Architectural style"
        anyLabel="All styles"
        value={filters.style}
        options={stylesOf(pool)}
        onChange={(value) => set("style", value)}
      />
      <FilterSelect
        label="Design feature"
        anyLabel="All features"
        value={filters.feature}
        options={featuresOf(pool)}
        onChange={(value) => set("feature", value)}
      />
      {statuses.length > 1 && (
        <select
          aria-label="Status"
          value={filters.status}
          onChange={(e) => set("status", e.target.value)}
        >
          <option value="">All statuses</option>
          {statuses.map((status) => (
            <option key={status}>{status}</option>
          ))}
        </select>
      )}
      {active > 0 && (
        <button type="button" className="filter-clear" onClick={reset}>
          Clear ({active})
        </button>
      )}
    </div>
  );
}
