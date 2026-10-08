import { formatInZone } from "../../domain/market-time";
import type { InvoiceSnapshot } from "../../domain/payments";
import { formatMoney } from "../../lib/format";

/** A snapshot day (`2026-10-07`) is a UTC day, so it is named as one. */
const day = (value: string) => formatInZone(`${value}T12:00:00Z`, "UTC", "date");

/**
 * The invoice as it was frozen at issue, drawn in the page. It reads the stored snapshot only, never live settings.
 * It is a convenience: the PDF is the official copy, and the printed page says so.
 */
export function InvoicePreview({ snapshot }: { snapshot: InvoiceSnapshot }) {
  const preferred = snapshot.instructions.find((method) => method.id === snapshot.preferred_method);
  return (
    <article className="admin-invoice" aria-label="Invoice preview">
      <header className="admin-invoice__head">
        <p className="admin-invoice__label">Preview. The PDF is the official copy.</p>
        <h2>Invoice {snapshot.invoice_number}</h2>
        <dl className="admin-invoice__dates">
          <div>
            <dt>Issued</dt>
            <dd>{day(snapshot.issue_date)}</dd>
          </div>
          <div>
            <dt>Due</dt>
            <dd>{day(snapshot.due_date)}</dd>
          </div>
        </dl>
      </header>
      <div className="admin-invoice__parties">
        <section aria-label="From">
          <h3>From</h3>
          <p>{snapshot.entity}</p>
          <p className="admin-prose">{snapshot.address}</p>
          <p>{snapshot.contact.email}</p>
          {snapshot.contact.phone === null ? null : <p>{snapshot.contact.phone}</p>}
        </section>
        <section aria-label="Bill to">
          <h3>Bill to</h3>
          <p>{snapshot.bill_to.name}</p>
          {snapshot.bill_to.brokerage === null ? null : <p>{snapshot.bill_to.brokerage}</p>}
          <p>{snapshot.bill_to.email}</p>
        </section>
        <section aria-label="Property">
          <h3>Property</h3>
          <p>{snapshot.bill_to.property}</p>
        </section>
      </div>
      <table className="admin-invoice__lines">
        <caption>Charges</caption>
        <tbody>
          <tr>
            <th scope="row">{snapshot.description}</th>
            <td>{formatMoney(snapshot.amount, snapshot.currency)}</td>
          </tr>
          <tr>
            <th scope="row">{snapshot.tax_line}</th>
            <td />
          </tr>
          <tr className="admin-invoice__total">
            <th scope="row">Total ({snapshot.currency})</th>
            <td>{formatMoney(snapshot.amount, snapshot.currency)}</td>
          </tr>
        </tbody>
      </table>
      <section aria-label="Payment">
        <h3>Payment</h3>
        <p>{snapshot.terms}</p>
        <p>{snapshot.late_terms}</p>
        {preferred === undefined ? null : <p>Preferred method: {preferred.label}</p>}
        <ul className="admin-invoice__methods">
          {snapshot.instructions
            .filter((method) => method.instructions !== "")
            .map((method) => (
              <li key={method.id}>
                <strong>{method.label}</strong>
                <p className="admin-prose">{method.instructions}</p>
              </li>
            ))}
        </ul>
        <p>Questions about this invoice: {snapshot.billing_email}</p>
      </section>
    </article>
  );
}
