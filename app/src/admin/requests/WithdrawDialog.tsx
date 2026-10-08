import { allowedActions, type SubmissionDetail } from "../../domain/admin-submissions";
import { ReasonDialog } from "../invoices/ReasonDialog";
import { usePayment } from "../invoices/payments-queries";
import { useAdminMe } from "../ui/admin-me";
import { RoleGate } from "../ui/RoleGate";
import { useToast } from "../ui/use-toast";
import { useWithdraw } from "./requests-queries";

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

/** Reads the request's newest invoice first, so the dialog names the one it voids; shown once that is known. */
function WithInvoice({ id, paymentId }: { id: string; paymentId: string }) {
  const payment = usePayment(paymentId);
  if (payment.data === undefined) return null;
  const { status, invoice_number: number } = payment.data;
  const invoice = number === null ? "the invoice that is due" : `invoice ${number}`;
  return <WithdrawForm id={id} invoice={status === "due" ? invoice : null} />;
}

/**
 * Screen 4's Withdraw (DL-04): from Accepted, Awaiting Assets or Invoice Issued to the terminal Withdrawn, with a
 * reason of 3 to 500 characters. A due invoice is voided in the same call, which only an admin may do.
 */
export function WithdrawDialog({ detail }: { detail: SubmissionDetail }) {
  const offered = allowedActions(detail.workflow_state, {
    acceptedAt: detail.accepted_at,
    paymentStatus: null,
  }).includes("withdraw");
  if (!offered) return null;
  return (
    <RoleGate action="submissions.withdraw">
      <div className="admin-actions">
        {detail.payment_id === null ? (
          <WithdrawForm id={detail.id} invoice={null} />
        ) : (
          <WithInvoice id={detail.id} paymentId={detail.payment_id} />
        )}
      </div>
    </RoleGate>
  );
}
