import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";
import { pageHead } from "../../lib/seo";

// A shell (ruling H66): the page lives in `src/admin/newsletter/InterestPage.tsx`, which the public entry never loads.
export const Route = createFileRoute("/admin/interest/")({
  errorComponent: lazyRouteComponent(
    () => import("../../admin/ui/AdminRouteError"),
    "AdminRouteError",
  ),
  head: () =>
    pageHead({
      title: "Interest",
      description: "Who asked to hear about which market, and from which page.",
      path: "/admin/interest",
      noindex: true,
    }),
  component: lazyRouteComponent(
    () => import("../../admin/newsletter/InterestPage"),
    "InterestPage",
  ),
});
