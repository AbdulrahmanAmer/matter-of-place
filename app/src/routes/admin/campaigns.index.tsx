import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";
import { pageHead } from "../../lib/seo";

// A shell (ruling H66): the page lives in `src/admin/campaigns/CampaignsPage.tsx`, which the public entry never loads.
export const Route = createFileRoute("/admin/campaigns/")({
  errorComponent: lazyRouteComponent(
    () => import("../../admin/ui/AdminRouteError"),
    "AdminRouteError",
  ),
  head: () =>
    pageHead({
      title: "Campaigns",
      description: "Each paid property's campaign: package, money, dates, channels and reports.",
      path: "/admin/campaigns",
      noindex: true,
    }),
  component: lazyRouteComponent(
    () => import("../../admin/campaigns/CampaignsPage"),
    "CampaignsPage",
  ),
});
