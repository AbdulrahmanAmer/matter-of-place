import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";
import { pageHead } from "../../lib/seo";

// A shell (ruling H66): the page lives in `src/admin/team/TeamPage.tsx`, which the public entry never loads.
export const Route = createFileRoute("/admin/team/")({
  errorComponent: lazyRouteComponent(
    () => import("../../admin/ui/AdminRouteError"),
    "AdminRouteError",
  ),
  head: () =>
    pageHead({
      title: "Team",
      description: "People and agents, their roles, agent keys and daily limits.",
      path: "/admin/team",
      noindex: true,
    }),
  component: lazyRouteComponent(() => import("../../admin/team/TeamPage"), "TeamPage"),
});
