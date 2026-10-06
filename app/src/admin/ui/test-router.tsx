import { render } from "@testing-library/react";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
  type AnyRoute,
} from "@tanstack/react-router";
import type { ReactNode } from "react";

/** A route with the id the file route would have: `/admin/people/` is the index, `/admin/people/$id` a detail. */
export function pageRoute(parent: AnyRoute, id: string, component: () => ReactNode = () => null) {
  return createRoute({
    getParentRoute: () => parent,
    path: id,
    component,
  });
}

/** Renders `layout` as the root route of a memory router opened at `at`, with the routes `children` builds. */
export function mountRoutes(
  layout: () => ReactNode,
  at: string,
  children: (root: AnyRoute) => AnyRoute[],
) {
  const root = createRootRoute({ component: layout });
  const router = createRouter({
    routeTree: root.addChildren(children(root)),
    history: createMemoryHistory({ initialEntries: [at] }),
  });
  render(<RouterProvider router={router} />);
  return router;
}
