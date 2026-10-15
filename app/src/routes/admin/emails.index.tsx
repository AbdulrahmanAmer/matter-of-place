import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";
import { pageHead } from "../../lib/seo";

// A shell (ruling H66): the page lives in `src/admin/audit/SentEmailsPage.tsx`, which the public entry never loads.
export const Route = createFileRoute("/admin/emails/")({
  errorComponent: lazyRouteComponent(
    () => import("../../admin/ui/AdminRouteError"),
    "AdminRouteError",
  ),
  head: () =>
    pageHead({
      title: "Sent emails",
      description: "Every email we sent, what became of it, and the do-not-send list.",
      path: "/admin/emails",
      noindex: true,
    }),
  component: lazyRouteComponent(() => import("../../admin/audit/SentEmailsPage"), "SentEmailsPage"),
});
