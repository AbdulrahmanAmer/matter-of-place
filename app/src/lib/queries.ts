import { queryOptions } from "@tanstack/react-query";
import type { ArchiveKind } from "../domain/archive";
import { isLive, services } from "../services";

/**
 * Query definitions for catalog reads. Route loaders call
 * `queryClient.ensureQueryData(...)` so navigations reuse cached data; the
 * stale time matches the edge cache TTL described in docs/architecture/caching.md.
 */
const catalogStaleTime = 5 * 60 * 1000;

export const propertiesQuery = () =>
  queryOptions({
    queryKey: ["properties"],
    queryFn: () => services.catalog.listProperties(),
    staleTime: catalogStaleTime,
  });

/** With a draft token, the preview a signed link opens (B7 invariant 14), cached apart from the public page. */
export const propertyQuery = (slug: string, draftToken?: string) =>
  queryOptions({
    queryKey:
      draftToken === undefined ? ["property", slug] : ["property", slug, "preview", draftToken],
    queryFn: () =>
      services.catalog.getProperty(slug, draftToken === undefined ? undefined : { draftToken }),
    staleTime: catalogStaleTime,
  });

export const marketsQuery = () =>
  queryOptions({
    queryKey: ["markets"],
    queryFn: () => services.catalog.listMarkets(),
    staleTime: catalogStaleTime,
  });

export const marketQuery = (slug: string) =>
  queryOptions({
    queryKey: ["market", slug],
    queryFn: () => services.catalog.getMarket(slug),
    staleTime: catalogStaleTime,
  });

export const storiesQuery = () =>
  queryOptions({
    queryKey: ["stories"],
    queryFn: () => services.catalog.listStories(),
    staleTime: catalogStaleTime,
  });

export const storyQuery = (slug: string) =>
  queryOptions({
    queryKey: ["story", slug],
    queryFn: () => services.catalog.getStory(slug),
    staleTime: catalogStaleTime,
  });

/** The archive page of one facet, null below the threshold or with the flag off; the local adapter has no archives. */
export const archiveQuery = (kind: ArchiveKind, slug: string) =>
  queryOptions({
    queryKey: ["archive", kind, slug],
    queryFn: async () => {
      if (!isLive) return null;
      const { getArchiveFn } = await import("./archive.functions");
      return getArchiveFn({ data: { kind, slug } });
    },
    staleTime: catalogStaleTime,
  });

/** The facets that exist, for the links of a property page. */
export const archiveFacetsQuery = () =>
  queryOptions({
    queryKey: ["archive-facets"],
    queryFn: async () => {
      if (!isLive) return null;
      const { getArchiveFacetsFn } = await import("./archive.functions");
      return getArchiveFacetsFn();
    },
    staleTime: catalogStaleTime,
  });
