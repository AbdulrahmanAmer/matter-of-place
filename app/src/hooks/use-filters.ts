import { useCallback, useMemo, useState } from "react";
import type { PropertyCard } from "../domain/property";
import { track } from "../lib/analytics";
import { designFeatures } from "../lib/catalog";

/**
 * Shared property filters. One state object and one filter function, so the
 * Properties, Market and Region pages behave identically.
 */
export type Filters = {
  term: string;
  market: string;
  location: string;
  type: string;
  beds: string;
  max: string;
  style: string;
  status: string;
  feature: string;
};

const emptyFilters: Filters = {
  term: "",
  market: "",
  location: "",
  type: "",
  beds: "",
  max: "",
  style: "",
  status: "",
  feature: "",
};

const matchesTerm = (property: PropertyCard, term: string) =>
  [
    property.city,
    property.neighborhood,
    property.state,
    property.title,
    property.style,
    property.type,
    property.region.replace(/-/g, " "),
  ]
    .join(" ")
    .toLowerCase()
    .includes(term);

const matchesLocation = (property: PropertyCard, location: string) =>
  property.region === location || property.neighborhood === location || property.city === location;

export function applyFilters(items: PropertyCard[], filters: Filters): PropertyCard[] {
  const term = filters.term.trim().toLowerCase();
  return items.filter(
    (property) =>
      (!term || matchesTerm(property, term)) &&
      (!filters.market || property.market === filters.market) &&
      (!filters.location || matchesLocation(property, filters.location)) &&
      (!filters.type || property.type === filters.type) &&
      (!filters.beds || property.beds >= Number(filters.beds)) &&
      (!filters.max || property.price <= Number(filters.max)) &&
      (!filters.style || property.style === filters.style) &&
      (!filters.status || property.status === filters.status) &&
      (!filters.feature || designFeatures(property).includes(filters.feature)),
  );
}

export type FilterState = {
  filters: Filters;
  set: (key: keyof Filters, value: string) => void;
  reset: () => void;
  /** Number of filters that differ from their initial value, excluding free text. */
  active: number;
};

const isFilterKey = (key: string): key is keyof Filters => Object.hasOwn(emptyFilters, key);
const countedFilters = Object.keys(emptyFilters)
  .filter(isFilterKey)
  .filter((key) => key !== "term");

export function useFilters(initial: Partial<Filters> = {}): FilterState {
  // Captured once: the initial values define what "cleared" means for this page.
  const [baseline] = useState<Filters>(() => ({ ...emptyFilters, ...initial }));
  const [filters, setFilters] = useState<Filters>(baseline);

  const set = useCallback((key: keyof Filters, value: string) => {
    setFilters((current) => ({ ...current, [key]: value }));
    if (key !== "term") track("filter_use", { key, value });
  }, []);

  const reset = useCallback(() => setFilters(baseline), [baseline]);

  const active = useMemo(
    () => countedFilters.filter((key) => filters[key] !== baseline[key]).length,
    [filters, baseline],
  );

  return { filters, set, reset, active };
}
