import { queryOptions } from "@tanstack/react-query";
import { rootRouteId, useMatch } from "@tanstack/react-router";
import type { ArchiveKind } from "../domain/archive";
import { emptySiteSettings, type PublicSite } from "../domain/settings";
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

/** The legal identity and whether illustrative content may show; it changes with the catalog version. */
export const siteQuery = () =>
  queryOptions({
    queryKey: ["site"],
    queryFn: () => services.site.get(),
    staleTime: catalogStaleTime,
  });

const noSite: PublicSite = { ...emptySiteSettings, illustrativeContent: false };

/**
 * The site identity the root loader filled with `siteQuery()`. Where that loader has not finished (the root error
 * page) every line is unset and illustrative content is off, so nothing false or empty renders. It reads the
 * router's match, not a query client, so it needs no provider above it.
 */
export function useSite(): PublicSite {
  return (
    useMatch({ from: rootRouteId, shouldThrow: false, select: (match) => match.loaderData }) ??
    noSite
  );
}

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
