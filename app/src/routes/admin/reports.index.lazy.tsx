import { createLazyFileRoute } from "@tanstack/react-router";
import { ReportsPage } from "../../admin/reports/ReportsPage";
import { AdminRouteError } from "../../admin/ui/AdminRouteError";

// The page of the `reports.index.tsx` shell (ruling H66). The route has no loader: the table and the open report
// each read their own data.
export const Route = createLazyFileRoute("/admin/reports/")({
  errorComponent: AdminRouteError,
  component: ReportsPage,
});
