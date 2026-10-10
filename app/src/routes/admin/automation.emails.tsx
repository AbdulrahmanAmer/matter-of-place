import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";
import { pageHead } from "../../lib/seo";

// A shell (ruling H66), named here and not spread from `adminRouteOptions()`: its `lazyRouteComponent` imports would
// sit in the route tree, which the public entry loads. The route has no loader, so there is no pending screen: the page
// shows its own loading line. The open template is the `key` of the address, read by the page.
export const Route = createFileRoute("/admin/automation/emails")({
  errorComponent: lazyRouteComponent(
    () => import("../../admin/ui/AdminRouteError"),
    "AdminRouteError",
  ),
  head: () =>
    pageHead({
      title: "Email templates",
      description: "What each email says: subject, blocks, variables and a preview.",
      path: "/admin/automation/emails",
      noindex: true,
    }),
  component: lazyRouteComponent(() => import("../../admin/automation/EmailsPage"), "EmailsPage"),
});
