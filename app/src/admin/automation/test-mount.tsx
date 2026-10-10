import { Outlet } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { vi } from "vitest";
import { mountRoutes, pageRoute } from "../ui/test-router";
import { AdminProviders } from "../ui/test-providers";

/**
 * Opens `page` at `path` for an actor who holds exactly `actions`, with `fetch` answered by `answer`: the Worker a
 * screen test stands in for. The caller restores the global with `vi.unstubAllGlobals()`.
 */
export function mountAdminPage(options: {
  actions: string[];
  path: string;
  page: ReactNode;
  answer: (path: string, init: RequestInit) => Response;
}) {
  vi.stubGlobal("fetch", (path: string, init: RequestInit = {}) =>
    Promise.resolve(options.answer(path, init)),
  );
  const layout = () => (
    <AdminProviders actions={options.actions}>
      <Outlet />
    </AdminProviders>
  );
  mountRoutes(layout, options.path, (root) => [pageRoute(root, options.path, () => options.page)]);
}
