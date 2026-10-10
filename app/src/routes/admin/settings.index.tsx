import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";
import { pageHead } from "../../lib/seo";

// A shell (ruling H66): the page lives in `src/admin/settings/SettingsPage.tsx`, which the public entry never loads.
export const Route = createFileRoute("/admin/settings/")({
  errorComponent: lazyRouteComponent(
    () => import("../../admin/ui/AdminRouteError"),
    "AdminRouteError",
  ),
  head: () =>
    pageHead({
      title: "Settings",
      description: "Business identity, invoicing, the coming-soon switch and alert recipients.",
      path: "/admin/settings",
      noindex: true,
    }),
  component: lazyRouteComponent(() => import("../../admin/settings/SettingsPage"), "SettingsPage"),
});
