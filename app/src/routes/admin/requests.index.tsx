import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";
import { pageHead } from "../../lib/seo";

// A shell (ruling H66), named here and not spread from `adminRouteOptions()`: its `lazyRouteComponent` imports would
// sit in the route tree, which the public entry loads. The route has no loader, so the table draws its own loading
// rows.
export const Route = createFileRoute("/admin/requests/")({
  errorComponent: lazyRouteComponent(
    () => import("../../admin/ui/AdminRouteError"),
    "AdminRouteError",
  ),
  head: () =>
    pageHead({
      title: "Requests",
      description: "Requests waiting for a decision.",
      path: "/admin/requests",
      noindex: true,
    }),
  component: lazyRouteComponent(() => import("../../admin/requests/RequestsPage"), "RequestsPage"),
});
