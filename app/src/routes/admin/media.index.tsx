import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";
import { pageHead } from "../../lib/seo";

// A shell (ruling H66): the page lives in `src/admin/media/MediaPage.tsx`, which the public entry never loads.
export const Route = createFileRoute("/admin/media/")({
  errorComponent: lazyRouteComponent(
    () => import("../../admin/ui/AdminRouteError"),
    "AdminRouteError",
  ),
  head: () =>
    pageHead({
      title: "Media",
      description: "The photographs of each property and where their renders stand.",
      path: "/admin/media",
      noindex: true,
    }),
  component: lazyRouteComponent(() => import("../../admin/media/MediaPage"), "MediaPage"),
});
