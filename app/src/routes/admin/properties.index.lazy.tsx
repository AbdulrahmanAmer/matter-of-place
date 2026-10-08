import { createLazyFileRoute, useRouter } from "@tanstack/react-router";
import { NewFromRequest } from "../../admin/properties/NewFromRequest";
import { PropertiesTable } from "../../admin/properties/PropertiesTable";
import {
  propertyFilterNames,
  useCreateFromSubmission,
  useProperties,
} from "../../admin/properties/properties-queries";
import { useSubmissions } from "../../admin/requests/requests-queries";
import { AdminApiError } from "../../admin/ui/admin-fetch";
import { AdminRouteError } from "../../admin/ui/AdminRouteError";
import { useAdminMe } from "../../admin/ui/admin-me";
import { useToast } from "../../admin/ui/use-toast";
import { useUrlFilters } from "../../admin/ui/use-url-filters";

// The page of the `properties.index.tsx` shell (ruling H66). The route has no loader, so the table draws its own
// loading rows.
export const Route = createLazyFileRoute("/admin/properties/")({
  errorComponent: AdminRouteError,
  component: PropertiesPage,
});

/** The request id of a failed read, for the table's error line. */
const requestIdOf = (failure: Error) =>
  failure instanceof AdminApiError && failure.requestId !== undefined
    ? { requestId: failure.requestId }
    : {};

function PropertiesPage() {
  const router = useRouter();
  const toast = useToast();
  const { actions } = useAdminMe();
  const filters = useUrlFilters(propertyFilterNames);
  const list = useProperties({
    ...filters.values,
    ...(filters.cursor === null ? {} : { cursor: filters.cursor }),
  });
  const waiting = useSubmissions({ without_property: "true" });
  const create = useCreateFromSubmission();
  const failure = list.error;
  const next = list.data?.next_cursor ?? null;
  const open = (id: string) => {
    void router.navigate({ href: `/admin/properties/${id}` });
  };
  return (
    <>
      <h1>Properties</h1>
      <PropertiesTable
        filters={{ values: filters.values, onChange: filters.setFilters }}
        rows={list.data?.items ?? []}
        loading={list.isPending}
        error={failure === null ? null : { message: failure.message, ...requestIdOf(failure) }}
        onOpen={(row) => {
          open(row.id);
        }}
        pager={{
          hasPrevious: filters.hasPrevious,
          hasNext: next !== null,
          onPrevious: filters.goPrevious,
          onNext: () => {
            if (next !== null) filters.goNext(next);
          },
        }}
      />
      {actions.includes("submissions.list") ? (
        <NewFromRequest
          requests={waiting.data?.items ?? []}
          creating={create.isPending ? create.variables : null}
          onCreate={(submissionId) => {
            create.mutate(submissionId, {
              onSuccess: (answer) => {
                open(answer.property_id);
              },
              onError: (error) => {
                toast({ message: error.message, tone: "danger" });
              },
            });
          }}
        />
      ) : null}
    </>
  );
}
