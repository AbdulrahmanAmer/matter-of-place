import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";
import { pageHead } from "../../lib/seo";

// A shell (ruling H66): the page lives in `src/admin/proposed-posts/ProposedPostsPage.tsx`, which the public entry
// never loads. The status filter and the page cursor are read from the address by the page (`use-url-filters.ts`).
export const Route = createFileRoute("/admin/proposed-posts/")({
  errorComponent: lazyRouteComponent(
    () => import("../../admin/ui/AdminRouteError"),
    "AdminRouteError",
  ),
  head: () =>
    pageHead({
      title: "Proposed posts",
      description: "What the team proposes to post, as it will look on each channel.",
      path: "/admin/proposed-posts",
      noindex: true,
    }),
  component: lazyRouteComponent(
    () => import("../../admin/proposed-posts/ProposedPostsPage"),
    "ProposedPostsPage",
  ),
});
