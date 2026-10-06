import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { lazyRouteComponent } from "@tanstack/react-router";
import { AdminApiError } from "./ui/admin-fetch";

// The data contract of every admin screen (invariant 20, FE-06): one key factory rooted at `["admin"]`, the
// defaults those queries share, the invalidation every write runs, and the options every child route takes.

function feature(name: string) {
  const all = () => ["admin", name] as const;
  return {
    all,
    list: (filters: unknown) => [...all(), "list", filters] as const,
    detail: (id: string) => [...all(), "detail", id] as const,
    timeline: (id: string) => [...all(), "timeline", id] as const,
  };
}

const automationKey = (name: string) => (filters?: unknown) =>
  ["admin", "automation", name, filters ?? null] as const;

export const adminKeys = {
  me: () => ["admin", "me"] as const,
  dashboard: () => ["admin", "dashboard"] as const,
  submissions: feature("submissions"),
  properties: feature("properties"),
  media: feature("media"),
  inquiries: feature("inquiries"),
  stories: feature("stories"),
  markets: feature("markets"),
  team: feature("team"),
  settings: feature("settings"),
  audit: feature("audit"),
  people: feature("people"),
  payments: feature("payments"),
  jobs: feature("jobs"),
  assets: feature("assets"),
  channels: feature("channels"),
  newsletter: feature("newsletter"),
  reports: feature("reports"),
  automation: {
    all: () => ["admin", "automation"] as const,
    recipes: automationKey("recipes"),
    templates: automationKey("templates"),
    reasons: automationKey("reasons"),
    channels: automationKey("channels"),
    schedules: automationKey("schedules"),
    revisions: automationKey("revisions"),
  },
};

/** A client error (4xx) is the answer, not a fault to try again; a server error or a lost connection gets one more try. */
function retryAdminQuery(failureCount: number, error: Error): boolean {
  if (error instanceof AdminApiError && error.status < 500) return false;
  return failureCount < 1;
}

export function installAdminQueryDefaults(queryClient: QueryClient): void {
  queryClient.setQueryDefaults(["admin"], {
    staleTime: 30_000,
    retry: retryAdminQuery,
    refetchOnWindowFocus: false,
  });
}

/** What a write's `onSettled` runs: its feature, the dashboard counts and, for one entity, its timeline. */
export async function invalidateAfterWrite(
  queryClient: QueryClient,
  featureKey: QueryKey,
  timelineKey?: QueryKey,
): Promise<void> {
  await Promise.all(
    [featureKey, adminKeys.dashboard(), timelineKey]
      .filter((queryKey) => queryKey !== undefined)
      .map((queryKey) => queryClient.invalidateQueries({ queryKey })),
  );
}

/** Spread into every admin child route: the error screen inside the shell and a skeleton after 300 ms. */
export function adminRouteOptions() {
  return {
    errorComponent: lazyRouteComponent(() => import("./ui/AdminRouteError"), "AdminRouteError"),
    pendingComponent: lazyRouteComponent(() => import("./ui/AdminPending"), "AdminPending"),
    pendingMs: 300,
  };
}
