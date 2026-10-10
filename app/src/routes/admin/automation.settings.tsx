import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";
import { pageHead } from "../../lib/seo";

// A shell (ruling H66), named here and not spread from `adminRouteOptions()`: its `lazyRouteComponent` imports would
// sit in the route tree, which the public entry loads. The route has no loader, so there is no pending screen: the page
// shows its own loading line.
export const Route = createFileRoute("/admin/automation/settings")({
  errorComponent: lazyRouteComponent(
    () => import("../../admin/ui/AdminRouteError"),
    "AdminRouteError",
  ),
  head: () =>
    pageHead({
      title: "Channels and schedules",
      description: "Posting windows, approval and the clocks that run the schedules.",
      path: "/admin/automation/settings",
      noindex: true,
    }),
  component: lazyRouteComponent(
    () => import("../../admin/automation/SettingsPage"),
    "SettingsPage",
  ),
});
