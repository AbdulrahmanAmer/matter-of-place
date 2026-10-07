import { createLazyFileRoute, useRouter } from "@tanstack/react-router";
import { InvoiceFilters } from "../../admin/invoices/InvoiceFilters";
import { InvoicesTable } from "../../admin/invoices/InvoicesTable";
import { invoiceFilterNames, usePayments } from "../../admin/invoices/payments-queries";
import { AdminApiError } from "../../admin/ui/admin-fetch";
import { AdminRouteError } from "../../admin/ui/AdminRouteError";
import { EmptyState } from "../../admin/ui/EmptyState";
import { RoleGate } from "../../admin/ui/RoleGate";
import { useUrlFilters } from "../../admin/ui/use-url-filters";

// The page of the `invoices.index.tsx` shell (ruling H66). The route has no loader, so the table draws its own
// loading rows.
export const Route = createLazyFileRoute("/admin/invoices/")({
  errorComponent: AdminRouteError,
  component: InvoicesPage,
});

function InvoicesPage() {
  const router = useRouter();
  const filters = useUrlFilters(invoiceFilterNames);
  const list = usePayments({
    ...filters.values,
    ...(filters.cursor === null ? {} : { cursor: filters.cursor }),
  });
  const page = list.data;
  const failure = list.error;
  return (
    <>
      <header className="admin-page-head">
        <h1>Invoices</h1>
        <RoleGate action="payments.issue">
          <a className="admin-button" href="/admin/invoices/new" data-print="hide">
            Issue invoice
          </a>
        </RoleGate>
      </header>
      <InvoiceFilters values={filters.values} onChange={filters.setFilters} />
      <InvoicesTable
        rows={page?.items ?? []}
        loading={list.isPending}
        error={
          failure === null
            ? null
            : {
                message: failure.message,
                ...(failure instanceof AdminApiError && failure.requestId !== undefined
                  ? { requestId: failure.requestId }
                  : {}),
              }
        }
        empty={
          <EmptyState title="No invoices">
            An invoice appears here once a request is accepted and invoiced.
          </EmptyState>
        }
        onOpen={(row) => {
          void router.navigate({ href: `/admin/invoices/${row.id}` });
        }}
        pager={{
          hasPrevious: filters.hasPrevious,
          hasNext: page?.next_cursor != null,
          onPrevious: filters.goPrevious,
          onNext: () => {
            if (page?.next_cursor != null) filters.goNext(page.next_cursor);
          },
        }}
      />
    </>
  );
}
