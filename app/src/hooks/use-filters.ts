import { useCallback, useMemo, useState } from "react";
import type { Property } from "../domain/property";
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

export const emptyFilters: Filters = {
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

const matchesTerm = (property: Property, term: string) =>
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

const matchesLocation = (property: Property, location: string) =>
  property.region === location || property.neighborhood === location || property.city === location;

export function applyFilters(items: Property[], filters: Filters): Property[] {
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
    () =>
      (Object.keys(emptyFilters) as (keyof Filters)[]).filter(
        (key) => key !== "term" && filters[key] !== baseline[key],
      ).length,
    [filters, baseline],
  );

  return { filters, set, reset, active };
}
