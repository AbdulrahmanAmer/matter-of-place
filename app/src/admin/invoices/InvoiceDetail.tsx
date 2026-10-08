import { notFound } from "@tanstack/react-router";
import { useState } from "react";
import { paymentStatusLabels } from "../../domain/payments";
import { formatMoney } from "../../lib/format";
import { AdminApiError } from "../ui/admin-fetch";
import { AdminPending } from "../ui/AdminPending";
import { EmptyState } from "../ui/EmptyState";
import { JobWatcher, type WatchedJob } from "../ui/JobWatcher";
import { LocalTime } from "../ui/LocalTime";
import { RoleGate } from "../ui/RoleGate";
import { StatusPill, type Tone } from "../ui/StatusPill";
import { useToast } from "../ui/use-toast";
import { ActivateButton } from "./ActivateButton";
import { InvoicePreview } from "./InvoicePreview";
import { MarkPaidDialog } from "./MarkPaidDialog";
import type { Payment } from "./payments-api";
import { useActivate, useMarkPaid, usePayment, useVoid, useWaive } from "./payments-queries";
import { VoidDialog } from "./VoidDialog";
import { WaiveDialog } from "./WaiveDialog";

const statusTone: Record<Payment["status"], Tone> = {
  due: "info",
  paid: "ok",
  waived: "neutral",
  refunded: "neutral",
  void: "neutral",
};

/** The copy job `activate` answers with has just been queued in the same transaction as the activation. */
const COPY_JOB = "copy_submission_media";

function Facts({ payment }: { payment: Payment }) {
  return (
    <dl className="admin-invoice-page__facts">
      <div>
        <dt>Product</dt>
        <dd>{payment.product}</dd>
      </div>
      <div>
        <dt>Amount</dt>
        <dd>{formatMoney(payment.amount, "USD")}</dd>
      </div>
      {payment.issued_at === null ? null : (
        <div>
          <dt>Issued</dt>
          <dd>
            <LocalTime value={payment.issued_at} />
          </dd>
        </div>
      )}
      {payment.due_at === null ? null : (
        <div>
          <dt>Due</dt>
          <dd>
            <LocalTime value={payment.due_at} />
          </dd>
        </div>
      )}
      {payment.paid_at === null ? null : (
        <div>
          <dt>Paid</dt>
          <dd>
            <LocalTime value={payment.paid_at} />
            {payment.paid_method === null ? null : `, ${payment.paid_method}`}
            {payment.paid_reference === null || payment.paid_reference === ""
              ? null
              : `, reference ${payment.paid_reference}`}
          </dd>
        </div>
      )}
      {payment.notes === null || payment.notes === "" ? null : (
        <div>
          <dt>Reason</dt>
          <dd className="admin-prose">{payment.notes}</dd>
        </div>
      )}
      <div>
        <dt>Request</dt>
        <dd>
          <a href={`/admin/requests/${payment.submission_id}`}>Open request</a>
        </dd>
      </div>
    </dl>
  );
}

function Loaded({ payment }: { payment: Payment }) {
  const toast = useToast();
  const [jobs, setJobs] = useState<readonly WatchedJob[]>([]);
  const markPaid = useMarkPaid(payment.id, payment.submission_id);
  const waive = useWaive(payment.id, payment.submission_id);
  const voided = useVoid(payment.id, payment.submission_id);
  const activate = useActivate(payment.submission_id);

  const done =
    <Answer extends { jobs: readonly WatchedJob[] }>(message: string) =>
    (answer: Answer): Answer => {
      setJobs(answer.jobs);
      toast({ message });
      return answer;
    };

  return (
    <>
      <header className="admin-page-head">
        <div>
          <p className="admin-invoice-page__crumb" data-print="hide">
            <a href="/admin/invoices">Invoices</a>
          </p>
          <h1>{payment.invoice_number ?? "No invoice"}</h1>
          <p className="admin-invoice-page__sub">{payment.product}</p>
        </div>
        <p className="admin-invoice-page__state" data-print="hide">
          <StatusPill
            label={paymentStatusLabels[payment.status]}
            tone={statusTone[payment.status]}
          />
          {payment.property_id === null ? null : <StatusPill label="Activated" tone="ok" />}
        </p>
      </header>
      <div className="admin-invoice-page">
        <div className="admin-invoice-page__main">
          {payment.invoice_snapshot === null ? (
            <EmptyState title="No invoice was issued">
              This was recorded as a waiver without an invoice: no number, no PDF and no email.
            </EmptyState>
          ) : (
            <InvoicePreview snapshot={payment.invoice_snapshot} />
          )}
        </div>
        <aside className="admin-invoice-page__side" data-print="hide">
          <section aria-label="Payment">
            <h2>Payment</h2>
            <Facts payment={payment} />
          </section>
          <div className="admin-actions">
            {payment.status === "due" ? (
              <>
                <RoleGate action="payments.mark_paid">
                  <MarkPaidDialog
                    onMarkPaid={(input) => markPaid.mutateAsync(input).then(done("Marked paid."))}
                  />
                </RoleGate>
                <RoleGate action="payments.waive">
                  <WaiveDialog
                    onWaive={(reason) => waive.mutateAsync(reason).then(done("Invoice waived."))}
                  />
                </RoleGate>
                <VoidDialog
                  onVoid={(reason) => voided.mutateAsync(reason).then(done("Invoice voided."))}
                />
              </>
            ) : null}
            {(payment.status === "paid" || payment.status === "waived") &&
            payment.property_id === null ? (
              <RoleGate action="submissions.activate">
                <ActivateButton
                  onActivate={() =>
                    activate.mutateAsync().then((answer) => {
                      const copyId = answer.copy_job_id;
                      const copy =
                        copyId === null || answer.jobs.some((job) => job.id === copyId)
                          ? []
                          : [{ id: copyId, type: COPY_JOB, status: "queued" }];
                      return done("Request activated.")({ jobs: [...answer.jobs, ...copy] });
                    })
                  }
                />
              </RoleGate>
            ) : null}
            {payment.property_id === null ? null : (
              <a href={`/admin/properties/${payment.property_id}`}>Open property</a>
            )}
            {payment.status === "void" ? (
              <RoleGate action="payments.issue">
                <a
                  className="admin-button"
                  href={`/admin/invoices/new?submission_id=${payment.submission_id}`}
                >
                  Issue corrected invoice
                </a>
              </RoleGate>
            ) : null}
          </div>
          {payment.invoice_number === null ? null : (
            <p>
              {payment.invoice_file_key === null ? (
                "The PDF is still being made."
              ) : (
                <a href={`/api/admin/payments/${payment.id}/pdf`} target="_blank" rel="noreferrer">
                  Open the PDF
                </a>
              )}
              {payment.invoice_snapshot === null ? null : (
                <>
                  {" "}
                  <button
                    type="button"
                    className="admin-button admin-button--quiet"
                    onClick={() => {
                      window.print();
                    }}
                  >
                    Print preview
                  </button>
                </>
              )}
            </p>
          )}
          <JobWatcher jobs={jobs} />
        </aside>
      </div>
    </>
  );
}

/** Screen 6 for an invoice or a waiver that exists: the invoice as frozen, its payment, and the moves open to the actor. */
export function InvoiceDetail({ id }: { id: string }) {
  const payment = usePayment(id);
  if (payment.data === undefined) {
    if (payment.error === null) return <AdminPending />;
    if (payment.error instanceof AdminApiError && payment.error.status === 404) throw notFound();
    throw payment.error;
  }
  return <Loaded payment={payment.data} />;
}
