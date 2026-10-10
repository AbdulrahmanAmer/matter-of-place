import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";
import { pageHead } from "../../lib/seo";

// A shell (ruling H66), named here and not spread from `adminRouteOptions()`: its `lazyRouteComponent` imports would
// sit in the route tree, which the public entry loads. The route has no loader, so there is no pending screen: the page
// shows its own loading line.
export const Route = createFileRoute("/admin/automation/reasons")({
  errorComponent: lazyRouteComponent(
    () => import("../../admin/ui/AdminRouteError"),
    "AdminRouteError",
  ),
  head: () =>
    pageHead({
      title: "Decline reasons",
      description: "The reasons for a decline and the paragraph each one puts in the email.",
      path: "/admin/automation/reasons",
      noindex: true,
    }),
  component: lazyRouteComponent(() => import("../../admin/automation/ReasonsPage"), "ReasonsPage"),
});
