import { createLazyFileRoute } from "@tanstack/react-router";
import { AssetCards } from "../../admin/assets/AssetCards";
import { assetFilterNames, useAssets } from "../../admin/assets/assets-queries";
import { AdminApiError } from "../../admin/ui/admin-fetch";
import { AdminPending } from "../../admin/ui/AdminPending";
import { AdminRouteError } from "../../admin/ui/AdminRouteError";
import { EmptyState } from "../../admin/ui/EmptyState";
import { Field } from "../../admin/ui/Field";
import { useUrlFilters } from "../../admin/ui/use-url-filters";
import { ADMIN_PAGE_MAX } from "../../domain/admin-page";
import { assetKindLabels, assetKinds, assetStatusLabels, assetStatuses } from "../../domain/assets";

// The page of the `assets.index.tsx` shell (ruling H66). The route has no loader: the page draws its own loading state.
export const Route = createLazyFileRoute("/admin/assets/")({
  errorComponent: AdminRouteError,
  component: AssetsPage,
});

function AssetsPage() {
  const filters = useUrlFilters(assetFilterNames);
  const { values, setFilters } = filters;
  const list = useAssets(values);
  const page = Number(values.page ?? "1");
  const total = list.data?.total ?? 0;
  const failure = list.error;

  const choose = (name: "status" | "kind") => (next: string) => {
    const { page: _page, ...rest } = values;
    setFilters({ ...rest, [name]: next });
  };

  return (
    <>
      <h1>Assets</h1>
      <div className="admin-toolbar">
        <Field label="Status">
          {(control) => (
            <select
              {...control}
              value={values.status ?? ""}
              onChange={(event) => {
                choose("status")(event.target.value);
              }}
            >
              <option value="">All</option>
              {assetStatuses.map((status) => (
                <option key={status} value={status}>
                  {assetStatusLabels[status]}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Kind">
          {(control) => (
            <select
              {...control}
              value={values.kind ?? ""}
              onChange={(event) => {
                choose("kind")(event.target.value);
              }}
            >
              <option value="">All</option>
              {assetKinds.map((kind) => (
                <option key={kind} value={kind}>
                  {assetKindLabels[kind]}
                </option>
              ))}
            </select>
          )}
        </Field>
        {values.property_id === undefined ? null : (
          <button
            type="button"
            className="admin-button admin-button--quiet"
            onClick={() => {
              const { property_id: _property, page: _page, ...rest } = values;
              setFilters(rest);
            }}
          >
            Show every property
          </button>
        )}
      </div>
      {failure === null ? null : (
        <p className="admin-asset__error" role="alert">
          {failure.message}
          {failure instanceof AdminApiError && failure.requestId !== undefined
            ? ` Request ${failure.requestId}.`
            : ""}
        </p>
      )}
      {list.isPending ? <AdminPending /> : null}
      {list.data === undefined ? null : list.data.items.length === 0 ? (
        <EmptyState title="No assets">Nothing matches these filters.</EmptyState>
      ) : (
        <AssetCards items={list.data.items} />
      )}
      {total <= ADMIN_PAGE_MAX ? null : (
        <div className="admin-pager" data-print="hide">
          <button
            type="button"
            className="admin-button admin-button--quiet"
            disabled={page <= 1}
            onClick={() => {
              setFilters({ ...values, page: String(page - 1) });
            }}
          >
            Previous
          </button>
          <button
            type="button"
            className="admin-button admin-button--quiet"
            disabled={page * ADMIN_PAGE_MAX >= total}
            onClick={() => {
              setFilters({ ...values, page: String(page + 1) });
            }}
          >
            Next
          </button>
        </div>
      )}
    </>
  );
}
