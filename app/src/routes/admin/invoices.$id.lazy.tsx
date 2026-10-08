import { createLazyFileRoute } from "@tanstack/react-router";
import { InvoiceDetail } from "../../admin/invoices/InvoiceDetail";
import { AdminRouteError } from "../../admin/ui/AdminRouteError";
import { EmptyState } from "../../admin/ui/EmptyState";

// The page of the `invoices.$id.tsx` shell (ruling H66). The route has no loader: the page reads its own payment,
// and a payment that is not there throws `notFound`.
export const Route = createLazyFileRoute("/admin/invoices/$id")({
  errorComponent: AdminRouteError,
  notFoundComponent: () => (
    <EmptyState title="Invoice not found">
      This invoice does not exist, or the link is no longer valid.
    </EmptyState>
  ),
  component: InvoicePage,
});

function InvoicePage() {
  const { id } = Route.useParams();
  return <InvoiceDetail id={id} />;
}
