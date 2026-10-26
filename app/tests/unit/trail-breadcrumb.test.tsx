// The visible trail of a page opener (SCH-008): Home, then the route's trail, the last crumb the current page; every
// earlier crumb is a router link, so following it navigates in the app instead of loading the page again.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { afterEach, describe, expect, it } from "vitest";
import { TrailBreadcrumb } from "../../src/components/site/trail-breadcrumb";
import type { Crumb } from "../../src/lib/jsonld";

const PAGE = "/california/big-sur";
const TRAIL: Crumb[] = [
  { name: "Markets", path: "/markets" },
  { name: "California", path: "/california" },
  { name: "Big Sur", path: PAGE },
];

/** The trail drawn by a page at its own path, as a region page draws it. */
async function drawn() {
  const rootRoute = createRootRoute({ component: Outlet });
  const page = createRoute({
    getParentRoute: () => rootRoute,
    path: PAGE,
    component: () => <TrailBreadcrumb trail={TRAIL} />,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([page]),
    history: createMemoryHistory({ initialEntries: [PAGE] }),
  });
  render(<RouterProvider router={router} />);
  const nav = await screen.findByRole("navigation", { name: "Breadcrumb" });
  return { router, nav };
}

afterEach(() => {
  cleanup();
});

describe("TrailBreadcrumb", () => {
  it("lists Home, an index, a market desk and the current page in order", async () => {
    const { nav } = await drawn();
    expect(
      within(nav)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["Home", "Markets", "California", "Big Sur"]);
    expect(
      within(nav)
        .getAllByRole("link")
        .map((link) => link.getAttribute("href")),
    ).toEqual(["/", "/markets", "/california"]);
  });

  it("marks only the page itself as current, never the market above it", async () => {
    const { nav } = await drawn();
    const current = [...nav.querySelectorAll("[aria-current]")];
    expect(current.map((node) => [node.tagName, node.textContent])).toEqual([["SPAN", "Big Sur"]]);
  });

  it("follows a crumb inside the app: the router moves to its path", async () => {
    const { router, nav } = await drawn();
    fireEvent.click(within(nav).getByRole("link", { name: "Markets" }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/markets");
    });
  });
});
