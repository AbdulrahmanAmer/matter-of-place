import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";
import { pageHead } from "../../lib/seo";

// A shell (ruling H66): the page lives in `src/admin/workforce/OfficePage.tsx`.
export const Route = createFileRoute("/admin/office")({
  errorComponent: lazyRouteComponent(
    () => import("../../admin/ui/AdminRouteError"),
    "AdminRouteError",
  ),
  head: () =>
    pageHead({
      title: "Office",
      description: "The AI colleagues of Matter of Place, live.",
      path: "/admin/office",
      noindex: true,
    }),
  component: lazyRouteComponent(() => import("../../admin/workforce/OfficePage"), "OfficePage"),
});
