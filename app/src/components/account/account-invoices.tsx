import type { AccountInvoice } from "../../domain/account";
import { formatInvoiceMoney } from "../../lib/format";
import { plainDay } from "./account-format";

/**
 * The status as a client reads it: when it is due or was paid, and "no charge" for a waiver. The room leaves a voided
 * invoice out (`account_invoices`), so "Cancelled" is only the word it would carry.
 */
function statusLine(invoice: AccountInvoice): string {
  if (invoice.credit) return "Covered by a Five Features credit";
  switch (invoice.status) {
    case "due":
      return invoice.due_at === null ? "Due" : `Due ${plainDay(invoice.due_at)}`;
    case "paid":
      return invoice.paid_at === null ? "Paid" : `Paid ${plainDay(invoice.paid_at)}`;
    case "waived":
      return "No charge";
    case "refunded":
      return "Refunded";
    case "void":
      return "Cancelled";
  }
}

/**
 * Invoices (W6 item 8): what is owed and what is paid, newest first. A pay link shows beside an invoice that is due
 * once Stripe provides one (`pay_url`); until then the way to pay is the one written on the invoice we emailed.
 */
export function AccountInvoices({ invoices }: { invoices: readonly AccountInvoice[] }) {
  if (invoices.length === 0) {
    return <p>Nothing here yet. An invoice we send you also appears here.</p>;
  }
  return (
    <>
      <p>Each invoice also reached you by email, with the way to pay.</p>
      <table className="account-table">
        <caption>Your invoices, newest first</caption>
        <thead>
          <tr>
            <th scope="col">Property</th>
            <th scope="col">Invoice</th>
            <th scope="col">Amount</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((invoice) => (
            <tr key={invoice.id}>
              <td>
                {invoice.address}, {invoice.city}
              </td>
              <td>
                {invoice.invoice_number ?? "No invoice"}
                {invoice.issued_at === null ? null : (
                  <>
                    <br />
                    {plainDay(invoice.issued_at)}
                  </>
                )}
              </td>
              <td>{formatInvoiceMoney(invoice.amount, invoice.currency)}</td>
              <td>
                {statusLine(invoice)}
                {invoice.status === "due" && invoice.pay_url !== null ? (
                  <>
                    <br />
                    <a href={invoice.pay_url}>Pay this invoice</a>
                  </>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
