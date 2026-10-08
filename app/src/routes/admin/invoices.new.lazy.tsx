import { createLazyFileRoute } from "@tanstack/react-router";
import { InvoiceDraft } from "../../admin/invoices/InvoiceDraft";
import { IssuePicker } from "../../admin/invoices/IssuePicker";
import { AdminRouteError } from "../../admin/ui/AdminRouteError";
import { EmptyState } from "../../admin/ui/EmptyState";

// The page of the `invoices.new.tsx` shell (ruling H66): the draft of one request, or the requests to pick from.
export const Route = createLazyFileRoute("/admin/invoices/new")({
  errorComponent: AdminRouteError,
  notFoundComponent: () => (
    <EmptyState title="Request not found">
      This request does not exist, or the link is no longer valid.
    </EmptyState>
  ),
  component: NewInvoicePage,
});

function NewInvoicePage() {
  const { submission_id: submissionId } = Route.useSearch();
  if (submissionId !== undefined) return <InvoiceDraft submissionId={submissionId} />;
  return (
    <>
      <h1>New invoice</h1>
      <p>Pick an accepted request.</p>
      <IssuePicker />
    </>
  );
}
