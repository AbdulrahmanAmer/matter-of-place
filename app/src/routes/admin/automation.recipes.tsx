import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";
import { pageHead } from "../../lib/seo";

// A shell (ruling H66), named here and not spread from `adminRouteOptions()`: its `lazyRouteComponent` imports would
// sit in the route tree, which the public entry loads. The route has no loader, so there is no pending screen: the page
// shows its own loading line. The open recipe is the `trigger` of the address, read by the page.
export const Route = createFileRoute("/admin/automation/recipes")({
  errorComponent: lazyRouteComponent(
    () => import("../../admin/ui/AdminRouteError"),
    "AdminRouteError",
  ),
  head: () =>
    pageHead({
      title: "Recipes",
      description: "What follows each event: the steps, their settings and when they apply.",
      path: "/admin/automation/recipes",
      noindex: true,
    }),
  component: lazyRouteComponent(() => import("../../admin/automation/RecipesPage"), "RecipesPage"),
});
