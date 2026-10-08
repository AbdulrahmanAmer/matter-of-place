import { notFound } from "@tanstack/react-router";
import { useState } from "react";
import { formatMoney } from "../../lib/format";
import { useSubmission } from "../requests/requests-queries";
import { stateTone } from "../requests/state-tone";
import { AdminApiError } from "../ui/admin-fetch";
import { AdminPending } from "../ui/AdminPending";
import { JobWatcher } from "../ui/JobWatcher";
import { StatusPill } from "../ui/StatusPill";
import { useToast } from "../ui/use-toast";
import { InvoiceForm } from "./InvoiceForm";
import type { WriteAnswer } from "./payments-api";
import { missingSettings, useIssueInvoice, useWaiveWithoutInvoice } from "./payments-queries";
import { WaiveWithoutInvoiceDialog } from "./WaiveWithoutInvoiceDialog";

/** Screen 6 before an invoice exists: the request, the draft, and "Waive without invoice" beside Issue. */
export function InvoiceDraft({ submissionId }: { submissionId: string }) {
  const toast = useToast();
  const request = useSubmission(submissionId);
  const issue = useIssueInvoice(submissionId);
  const waive = useWaiveWithoutInvoice(submissionId);
  const [recorded, setRecorded] = useState<{ answer: WriteAnswer; what: string } | null>(null);

  const detail = request.data;
  if (detail === undefined) {
    if (request.error === null) return <AdminPending />;
    if (request.error instanceof AdminApiError && request.error.status === 404) throw notFound();
    throw request.error;
  }
  const issuable =
    detail.workflow_state === "Accepted" || detail.workflow_state === "Invoice Issued";
  const initialProduct = detail.package === "Not sure yet" ? "" : detail.package;

  const record = (what: string) => (answer: WriteAnswer) => {
    setRecorded({ answer, what });
    toast({ message: `${what}.` });
    return answer;
  };

  return (
    <>
      <header className="admin-page-head">
        <div>
          <p className="admin-invoice-page__crumb" data-print="hide">
            <a href="/admin/invoices">Invoices</a>
          </p>
          <h1>New invoice</h1>
          <p className="admin-invoice-page__sub">
            {detail.address}, {detail.city}, {detail.state}
          </p>
        </div>
        <p className="admin-invoice-page__state" data-print="hide">
          <StatusPill label={detail.workflow_state} tone={stateTone[detail.workflow_state]} />
        </p>
      </header>
      {recorded === null ? (
        <>
          <p>
            {detail.submitter_name} chose {detail.package}
            {detail.price === null
              ? ""
              : ` for a property listed at ${formatMoney(detail.price, detail.currency)}`}
            .
          </p>
          <InvoiceForm
            initialProduct={initialProduct}
            canIssue={detail.accepted_at !== null && issuable}
            missing={missingSettings(issue.error)}
            onIssue={(input) => issue.mutateAsync(input).then(record("Invoice issued"))}
          >
            <WaiveWithoutInvoiceDialog
              initialProduct={initialProduct}
              onWaive={(input) => waive.mutateAsync(input).then(record("Waiver recorded"))}
            />
          </InvoiceForm>
        </>
      ) : (
        <section aria-label="Recorded">
          <p role="status">{recorded.what}.</p>
          <p>
            <a href={`/admin/invoices/${recorded.answer.payment_id}`}>Open it</a>
          </p>
          <JobWatcher jobs={recorded.answer.jobs} />
        </section>
      )}
    </>
  );
}
