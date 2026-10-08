import { allowedActions, type SubmissionDetail } from "../../domain/admin-submissions";
import type { TransitionContext } from "../../domain/workflow";
import { ReasonDialog } from "../invoices/ReasonDialog";
import { usePayment } from "../invoices/payments-queries";
import { AdminApiError } from "../ui/admin-fetch";
import { useAdminMe } from "../ui/admin-me";
import { RoleGate } from "../ui/RoleGate";
import { useToast } from "../ui/use-toast";
import { useWithdraw } from "./requests-queries";

function offered(detail: SubmissionDetail, paymentStatus: TransitionContext["paymentStatus"]) {
  return allowedActions(detail.workflow_state, {
    acceptedAt: detail.accepted_at,
    paymentStatus,
  }).includes("withdraw");
}

/** The reason form; `invoice` names the due invoice the withdrawal voids, or is null when there is none. */
function WithdrawForm({ id, invoice }: { id: string; invoice: string | null }) {
  const { actions } = useAdminMe();
  const toast = useToast();
  const withdraw = useWithdraw(id);
  const needsAdmin = invoice !== null && !actions.includes("payments.void");
  return (
    <ReasonDialog
      trigger="Withdraw"
      title="Withdraw this request"
      confirmLabel="Withdraw request"
      intro="The request closes for good. No letter is sent."
      danger
      canSubmit={!needsAdmin}
      onSubmit={async (reason) => {
        await withdraw.mutateAsync(reason);
        toast({ message: "Request withdrawn." });
      }}
    >
      {invoice === null ? null : (
        <p>
          {`This also voids ${invoice}.`}
          {needsAdmin ? " Only an admin can void an invoice." : null}
        </p>
      )}
    </ReasonDialog>
  );
}

/**
 * Reads the request's newest invoice first, so the dialog names the one it voids; a paid or waived invoice keeps
 * Withdraw off, as the gate would refuse it.
 */
function WithInvoice({ detail, paymentId }: { detail: SubmissionDetail; paymentId: string }) {
  const payment = usePayment(paymentId);
  if (payment.error !== null) {
    const requestId = payment.error instanceof AdminApiError ? payment.error.requestId : undefined;
    return (
      <p role="alert">
        {payment.error.message}
        {requestId === undefined ? null : ` Request ${requestId}.`}
      </p>
    );
  }
  if (payment.data === undefined) return <p aria-busy="true">Loading the invoice.</p>;
  const { status, invoice_number: number } = payment.data;
  if (!offered(detail, status)) return null;
  const invoice = number === null ? "the invoice that is due" : `invoice ${number}`;
  return <WithdrawForm id={detail.id} invoice={status === "due" ? invoice : null} />;
}

/**
 * Screen 4's Withdraw (DL-04): from Accepted, Awaiting Assets or Invoice Issued to the terminal Withdrawn, with a
 * reason of 3 to 500 characters. A due invoice is voided in the same call, which only an admin may do.
 */
export function WithdrawDialog({ detail }: { detail: SubmissionDetail }) {
  if (!offered(detail, null)) return null;
  return (
    <RoleGate action="submissions.withdraw">
      <div className="admin-actions">
        {detail.payment_id === null ? (
          <WithdrawForm id={detail.id} invoice={null} />
        ) : (
          <WithInvoice detail={detail} paymentId={detail.payment_id} />
        )}
      </div>
    </RoleGate>
  );
}
