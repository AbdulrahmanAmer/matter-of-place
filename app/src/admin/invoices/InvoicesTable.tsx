import type { ComponentProps } from "react";
import { paymentStatusLabels, type InvoiceListRow } from "../../domain/payments";
import { formatMoney } from "../../lib/format";
import { DataTable, type Column } from "../ui/DataTable";
import { LocalTime } from "../ui/LocalTime";
import { StatusPill, type Tone } from "../ui/StatusPill";

const statusTone: Record<InvoiceListRow["status"], Tone> = {
  due: "info",
  paid: "ok",
  waived: "neutral",
  refunded: "neutral",
  void: "neutral",
};

type TableProps = ComponentProps<typeof DataTable<InvoiceListRow>>;

const when = (value: string | null) =>
  value === null ? null : <LocalTime value={value} style="date" />;

const columns: Column<InvoiceListRow>[] = [
  {
    key: "number",
    header: "Invoice",
    render: (row) => row.invoice_number ?? "No invoice",
  },
  { key: "submitter", header: "Submitter", render: (row) => row.submitter_name },
  { key: "product", header: "Product", render: (row) => row.product },
  {
    key: "amount",
    header: "Amount",
    align: "end",
    render: (row) => formatMoney(row.amount, "USD"),
  },
  {
    key: "status",
    header: "Status",
    render: (row) => (
      <>
        <StatusPill label={paymentStatusLabels[row.status]} tone={statusTone[row.status]} />
        {row.status === "due" && row.overdue === true ? (
          <>
            {" "}
            <span className="admin-overdue" data-overdue="true">
              <StatusPill label="Overdue" tone="danger" />
            </span>
          </>
        ) : null}
      </>
    ),
  },
  { key: "issued", header: "Issued", render: (row) => when(row.issued_at) },
  { key: "paid", header: "Paid", render: (row) => when(row.paid_at) },
];

/**
 * Screen 5's table. A waiver recorded without an invoice has no number and reads "No invoice". A due invoice past
 * its due date carries an Overdue pill, which also tints its row.
 */
export function InvoicesTable({
  rows,
  ...table
}: Omit<TableProps, "caption" | "columns" | "rowId" | "rows"> & {
  rows: readonly InvoiceListRow[];
}) {
  return (
    <DataTable
      caption="Invoices"
      columns={columns}
      rows={rows}
      rowId={(row) => row.id}
      {...table}
    />
  );
}
