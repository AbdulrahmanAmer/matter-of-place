// Renders a component inside a router on a memory history, so a `Link` or a `Navigate` in it works in a component test.
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";

/** Renders `ui` as the only route's page at `path`. Wait for what it shows with `findBy...`: a router renders async. */
export function renderInRouter(ui: ReactNode, path = "/") {
  const router = createRouter({
    routeTree: createRootRoute({ component: () => ui }),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(<RouterProvider router={router} />);
  return router;
}
