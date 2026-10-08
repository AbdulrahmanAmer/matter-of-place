import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";
import { pageHead } from "../../lib/seo";

// A shell (ruling H66): the page is `src/admin/dashboard/DashboardPage.tsx`, loaded inside the route.
export const Route = createFileRoute("/admin/")({
  errorComponent: lazyRouteComponent(
    () => import("../../admin/ui/AdminRouteError"),
    "AdminRouteError",
  ),
  head: () =>
    pageHead({
      title: "Dashboard",
      description: "The day in one screen.",
      path: "/admin",
      noindex: true,
    }),
  component: lazyRouteComponent(
    () => import("../../admin/dashboard/DashboardPage"),
    "DashboardPage",
  ),
});
