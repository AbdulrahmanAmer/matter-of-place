import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";
import { pageHead } from "../../lib/seo";

// A shell (ruling H66), named here and not spread from `adminRouteOptions()`: its `lazyRouteComponent` imports would
// sit in the route tree, which the public entry loads. The route has no loader, so there is no pending screen: the
// table draws its own loading rows.
export const Route = createFileRoute("/admin/automation/revisions")({
  errorComponent: lazyRouteComponent(
    () => import("../../admin/ui/AdminRouteError"),
    "AdminRouteError",
  ),
  head: () =>
    pageHead({
      title: "Revisions",
      description: "Every change to a recipe, an email, a decline reason, a channel or a schedule.",
      path: "/admin/automation/revisions",
      noindex: true,
    }),
  component: lazyRouteComponent(
    () => import("../../admin/automation/RevisionsPage"),
    "RevisionsPage",
  ),
});
