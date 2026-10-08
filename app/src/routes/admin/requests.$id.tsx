import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";
import { pageHead } from "../../lib/seo";

// A shell (ruling H66), named here and not spread from `adminRouteOptions()` (see requests.index.tsx). The route has
// no loader: a loader and everything it imports stay in the public entry, which the bundle budget does not allow.
// The page reads its own request, and a request that is not there throws `notFound`.
export const Route = createFileRoute("/admin/requests/$id")({
  errorComponent: lazyRouteComponent(
    () => import("../../admin/ui/AdminRouteError"),
    "AdminRouteError",
  ),
  notFoundComponent: lazyRouteComponent(
    () => import("../../admin/requests/RequestPage"),
    "RequestNotFound",
  ),
  head: ({ params }) =>
    pageHead({
      title: "Request",
      description: "One request and its history.",
      path: `/admin/requests/${params.id}`,
      noindex: true,
    }),
  component: lazyRouteComponent(() => import("../../admin/requests/RequestPage"), "RequestPage"),
});
