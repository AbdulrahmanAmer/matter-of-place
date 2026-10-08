import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";
import { pageHead } from "../../lib/seo";

// A shell (ruling H66): the page lives in `src/admin/stories/StoriesPage.tsx`, which the public entry never loads. The
// search keeps the state filter and the cursor.
const text = (value: unknown): string | undefined =>
  typeof value === "string" && value !== "" ? value : undefined;

export const Route = createFileRoute("/admin/stories/")({
  validateSearch: (search: Record<string, unknown>) => ({
    editorial_state: text(search["editorial_state"]),
    cursor: text(search["cursor"]),
  }),
  errorComponent: lazyRouteComponent(
    () => import("../../admin/ui/AdminRouteError"),
    "AdminRouteError",
  ),
  head: () =>
    pageHead({
      title: "Stories",
      description: "Every story, its state and its image.",
      path: "/admin/stories",
      noindex: true,
    }),
  component: lazyRouteComponent(() => import("../../admin/stories/StoriesPage"), "StoriesPage"),
});
