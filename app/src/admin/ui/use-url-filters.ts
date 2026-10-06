import { useRouter, useRouterState } from "@tanstack/react-router";
import { useRef } from "react";

export interface UrlFilters<Name extends string> {
  /** The filters in the address; a filter that is not there is missing, not empty. */
  values: Readonly<Partial<Record<Name, string>>>;
  /** The keyset cursor of the page now shown, or null on the first page. */
  cursor: string | null;
  /** Replaces every filter with `next` (empty values are dropped) and goes back to the first page. */
  setFilters: (next: Readonly<Partial<Record<Name, string>>>) => void;
  /** Opens the page after this one, which starts at `next`. */
  goNext: (next: string) => void;
  hasPrevious: boolean;
  goPrevious: () => void;
}

const CURSOR = "cursor";

/**
 * A list screen's filters and page live in the address, so a link, a reload and the back button all land on the
 * same rows (admin-screens, DataTable). Keyset pages cannot be walked backwards from a cursor, so the cursors
 * this page was reached through are kept for Previous; a page opened from a pasted link has none.
 */
export function useUrlFilters<Name extends string>(names: readonly Name[]): UrlFilters<Name> {
  const router = useRouter();
  const location = useRouterState({ select: (state) => state.location });
  const trail = useRef<(string | null)[]>([]);
  const params = new URLSearchParams(location.searchStr);

  const values: Partial<Record<Name, string>> = {};
  for (const name of names) {
    const value = params.get(name);
    if (value !== null && value !== "") values[name] = value;
  }
  const cursor = params.get(CURSOR);

  const open = (next: URLSearchParams) => {
    const search = next.size === 0 ? "" : `?${next.toString()}`;
    void router.navigate({ href: `${location.pathname}${search}` });
  };

  return {
    values,
    cursor,
    setFilters: (next) => {
      trail.current = [];
      const search = new URLSearchParams();
      for (const name of names) {
        const value = next[name];
        if (value !== undefined && value !== "") search.set(name, value);
      }
      open(search);
    },
    goNext: (next) => {
      trail.current.push(cursor);
      const search = new URLSearchParams(params);
      search.set(CURSOR, next);
      open(search);
    },
    hasPrevious: trail.current.length > 0,
    goPrevious: () => {
      const before = trail.current.pop();
      const search = new URLSearchParams(params);
      if (before === undefined || before === null) search.delete(CURSOR);
      else search.set(CURSOR, before);
      open(search);
    },
  };
}
