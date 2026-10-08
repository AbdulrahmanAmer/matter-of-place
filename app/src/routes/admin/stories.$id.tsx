import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";
import { pageHead } from "../../lib/seo";

// A shell (ruling H66): the editor lives in `src/admin/stories/StoryPage.tsx`, which the public entry never loads.
export const Route = createFileRoute("/admin/stories/$id")({
  errorComponent: lazyRouteComponent(
    () => import("../../admin/ui/AdminRouteError"),
    "AdminRouteError",
  ),
  notFoundComponent: lazyRouteComponent(
    () => import("../../admin/stories/StoryNotFound"),
    "StoryNotFound",
  ),
  head: ({ params }) =>
    pageHead({
      title: "Story",
      description: "One story: its text, its image and its state.",
      path: `/admin/stories/${params.id}`,
      noindex: true,
    }),
  component: lazyRouteComponent(() => import("../../admin/stories/StoryPage"), "StoryPage"),
});
