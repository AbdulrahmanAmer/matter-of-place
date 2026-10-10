import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";
import { pageHead } from "../../lib/seo";

// A shell (ruling H66): the page lives in `src/admin/audit/AuditPage.tsx`, which the public entry never loads. The
// filters and the cursor stay in the address, where `useUrlFilters` reads them.
export const Route = createFileRoute("/admin/audit/")({
  errorComponent: lazyRouteComponent(
    () => import("../../admin/ui/AdminRouteError"),
    "AdminRouteError",
  ),
  head: () =>
    pageHead({
      title: "Audit log",
      description: "Every change made in the admin, by whom, and what it changed.",
      path: "/admin/audit",
      noindex: true,
    }),
  component: lazyRouteComponent(() => import("../../admin/audit/AuditPage"), "AuditPage"),
});
