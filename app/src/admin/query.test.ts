import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import {
  adminKeys,
  adminRouteOptions,
  installAdminQueryDefaults,
  invalidateAfterWrite,
} from "./query";
import { AdminApiError } from "./ui/admin-fetch";

function client() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } });
  installAdminQueryDefaults(queryClient);
  return queryClient;
}

/** How many times the query function ran before `fetchQuery` gave up on an error of this kind. */
async function attempts(error: Error) {
  const queryFn = vi.fn(() => Promise.reject(error));
  await client()
    .fetchQuery({ queryKey: adminKeys.submissions.list({}), queryFn })
    .catch(() => undefined);
  return queryFn.mock.calls.length;
}

describe("admin query defaults", () => {
  it("a 403 is not retried", async () => {
    expect(await attempts(new AdminApiError(403, "forbidden", "No"))).toBe(1);
  });

  it("a 503 is retried once", async () => {
    expect(await attempts(new AdminApiError(503, "unavailable", "Later"))).toBe(2);
  });

  it("a lost connection is retried once", async () => {
    expect(await attempts(new TypeError("Failed to fetch"))).toBe(2);
  });

  it("a read stays fresh for 30 seconds and does not refetch on focus", () => {
    expect(client().getQueryDefaults(adminKeys.team.all())).toMatchObject({
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    });
  });

  it("every key starts at the admin root, so one call can empty them all", () => {
    const keys = [
      adminKeys.me(),
      adminKeys.dashboard(),
      adminKeys.submissions.list({ state: "new" }),
      adminKeys.properties.detail("p1"),
      adminKeys.people.timeline("c1"),
      adminKeys.automation.recipes(),
    ];
    expect(keys.map((key) => key[0])).toEqual(Array<string>(keys.length).fill("admin"));
  });
});

describe("a write", () => {
  it("invalidates its feature, the dashboard and its timeline, and nothing else", async () => {
    const queryClient = client();
    const keys = {
      list: adminKeys.submissions.list({ state: "new" }),
      detail: adminKeys.submissions.detail("s1"),
      dashboard: adminKeys.dashboard(),
      timeline: adminKeys.properties.timeline("p1"),
      other: adminKeys.people.list({}),
    };
    for (const key of Object.values(keys)) queryClient.setQueryData(key, []);
    await invalidateAfterWrite(queryClient, adminKeys.submissions.all(), keys.timeline);
    const stale = (key: readonly unknown[]) => queryClient.getQueryState(key)?.isInvalidated;
    expect([keys.list, keys.detail, keys.dashboard, keys.timeline].map(stale)).toEqual([
      true,
      true,
      true,
      true,
    ]);
    expect(stale(keys.other)).toBe(false);
  });
});

describe("admin route options", () => {
  it("every child route shows its skeleton after 300 ms", () => {
    expect(adminRouteOptions().pendingMs).toBe(300);
  });
});
