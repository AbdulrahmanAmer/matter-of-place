import { createLazyFileRoute } from "@tanstack/react-router";
import { JobsPage } from "../../admin/jobs/JobsPage";
import { AdminRouteError } from "../../admin/ui/AdminRouteError";

// The page of the `jobs.index.tsx` shell (ruling H66). The route has no loader: the banner, the table and the open job
// each read their own data.
export const Route = createLazyFileRoute("/admin/jobs/")({
  errorComponent: AdminRouteError,
  component: JobsPage,
});
