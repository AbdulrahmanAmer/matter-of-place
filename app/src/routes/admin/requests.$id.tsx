import { createFileRoute } from "@tanstack/react-router";
import { RequestDetail } from "../../admin/requests/RequestDetail";
import { AdminRouteError } from "../../admin/ui/AdminRouteError";
import { EmptyState } from "../../admin/ui/EmptyState";
import { pageHead } from "../../lib/seo";

// Named here, not spread from `adminRouteOptions()` (see requests.index.tsx). The route has no loader: a loader and
// everything it imports stay in the public entry, which the bundle budget does not allow. The page reads its own
// request, and a request that is not there throws `notFound`.
export const Route = createFileRoute("/admin/requests/$id")({
  errorComponent: AdminRouteError,
  notFoundComponent: () => (
    <EmptyState title="Request not found">
      This request does not exist, or the link is no longer valid.
    </EmptyState>
  ),
  head: ({ params }) =>
    pageHead({
      title: "Request",
      description: "One request and its history.",
      path: `/admin/requests/${params.id}`,
      noindex: true,
    }),
  component: RequestPage,
});

function RequestPage() {
  const { id } = Route.useParams();
  return <RequestDetail id={id} />;
}
