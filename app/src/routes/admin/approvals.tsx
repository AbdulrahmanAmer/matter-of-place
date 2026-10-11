import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";
import { pageHead } from "../../lib/seo";

// A shell (ruling H66): the page lives in `src/admin/workforce/ApprovalsPage.tsx`.
export const Route = createFileRoute("/admin/approvals")({
  errorComponent: lazyRouteComponent(
    () => import("../../admin/ui/AdminRouteError"),
    "AdminRouteError",
  ),
  head: () =>
    pageHead({
      title: "Approvals",
      description: "What the team proposes, waiting for a person.",
      path: "/admin/approvals",
      noindex: true,
    }),
  component: lazyRouteComponent(
    () => import("../../admin/workforce/ApprovalsPage"),
    "ApprovalsPage",
  ),
});
