import { getRouteApi } from "@tanstack/react-router";
import { EmptyState } from "../ui/EmptyState";
import { RequestDetail } from "./RequestDetail";

const request = getRouteApi("/admin/requests/$id");

/** The component of `src/routes/admin/requests.$id.tsx`. */
export function RequestPage() {
  const { id } = request.useParams();
  return <RequestDetail id={id} />;
}

/** The `notFoundComponent` of the same route. */
export function RequestNotFound() {
  return (
    <EmptyState title="Request not found">
      This request does not exist, or the link is no longer valid.
    </EmptyState>
  );
}
