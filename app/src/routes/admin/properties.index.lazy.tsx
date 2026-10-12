import { createLazyFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { NewFromRequest } from "../../admin/properties/NewFromRequest";
import { NewPropertyDialog } from "../../admin/properties/NewPropertyDialog";
import { PropertiesTable } from "../../admin/properties/PropertiesTable";
import {
  propertyFilterNames,
  useCreateFromSubmission,
  useCreateProperty,
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
  const createByHand = useCreateProperty();
  const [newOpen, setNewOpen] = useState(false);
  const failure = list.error;
  const next = list.data?.next_cursor ?? null;
  const open = (id: string) => {
    void router.navigate({ href: `/admin/properties/${id}` });
  };
  return (
    <>
      <header className="admin-page-head">
        <div>
          <h1>Properties</h1>
          <p className="admin-lead">
            Every property we hold, draft or published. Open one to edit, publish or take it down.
          </p>
        </div>
        {actions.includes("properties.create") ? (
          <button
            type="button"
            className="admin-button"
            onClick={() => {
              createByHand.reset();
              setNewOpen(true);
            }}
          >
            New property
          </button>
        ) : null}
      </header>
      <NewPropertyDialog
        open={newOpen}
        pending={createByHand.isPending}
        refusal={createByHand.error?.message ?? null}
        onClose={() => {
          setNewOpen(false);
        }}
        onCreate={(input) => {
          createByHand.mutate(input, {
            onSuccess: (answer) => {
              setNewOpen(false);
              open(answer.property_id);
            },
          });
        }}
      />
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
