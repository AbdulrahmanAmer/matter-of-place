import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";
import { pageHead } from "../../lib/seo";

// A shell (ruling H66): the page lives in `src/admin/markets/MarketsPage.tsx`, which the public entry never loads. The
// search keeps the market that is open.
const text = (value: unknown): string | undefined =>
  typeof value === "string" && value !== "" ? value : undefined;

export const Route = createFileRoute("/admin/markets/")({
  validateSearch: (search: Record<string, unknown>) => ({ market: text(search["market"]) }),
  errorComponent: lazyRouteComponent(
    () => import("../../admin/ui/AdminRouteError"),
    "AdminRouteError",
  ),
  head: () =>
    pageHead({
      title: "Markets",
      description: "Each market: whether it is open, its text, regions, notes and guide.",
      path: "/admin/markets",
      noindex: true,
    }),
  component: lazyRouteComponent(() => import("../../admin/markets/MarketsPage"), "MarketsPage"),
});
