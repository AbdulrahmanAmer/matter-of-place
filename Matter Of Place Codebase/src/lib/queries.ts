import { queryOptions } from "@tanstack/react-query";
import { services } from "../services";

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

export const propertyQuery = (slug: string) =>
  queryOptions({
    queryKey: ["property", slug],
    queryFn: () => services.catalog.getProperty(slug),
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
