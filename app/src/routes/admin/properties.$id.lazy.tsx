import { createLazyFileRoute, notFound } from "@tanstack/react-router";
import { PropertyEditor } from "../../admin/properties/PropertyEditor";
import { useProperty } from "../../admin/properties/properties-queries";
import { AdminApiError } from "../../admin/ui/admin-fetch";
import { AdminPending } from "../../admin/ui/AdminPending";
import { AdminRouteError } from "../../admin/ui/AdminRouteError";
import { EmptyState } from "../../admin/ui/EmptyState";

// The page of the `properties.$id.tsx` shell (ruling H66). The route has no loader: the page reads its own property,
// and a property that is not there throws `notFound`.
export const Route = createLazyFileRoute("/admin/properties/$id")({
  errorComponent: AdminRouteError,
  notFoundComponent: () => (
    <EmptyState title="Property not found">
      This property does not exist, or the link is no longer valid.
    </EmptyState>
  ),
  component: PropertyPage,
});

function PropertyPage() {
  const { id } = Route.useParams();
  const property = useProperty(id);
  const detail = property.data;
  if (detail === undefined) {
    if (property.error === null) return <AdminPending />;
    if (property.error instanceof AdminApiError && property.error.status === 404) throw notFound();
    throw property.error;
  }
  return (
    <PropertyEditor
      key={detail.property.id}
      detail={detail}
      onReload={() =>
        property.refetch({ throwOnError: true }).then(({ data }) => {
          if (data === undefined) throw new Error("The property could not be reloaded.");
          return data;
        })
      }
    />
  );
}
