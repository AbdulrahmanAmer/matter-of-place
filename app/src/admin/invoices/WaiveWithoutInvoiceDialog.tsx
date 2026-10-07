import { useState } from "react";
import { invoiceProducts } from "../../domain/payments";
import { Field } from "../ui/Field";
import { RoleGate } from "../ui/RoleGate";
import { ReasonDialog } from "./ReasonDialog";

/**
 * A Five Features credit or a comp, recorded with no invoice (invariant 12): the product and a reason. No number,
 * no PDF and no email to the submitter.
 */
export function WaiveWithoutInvoiceDialog({
  initialProduct,
  onWaive,
}: {
  /** The package the request chose, when it is a product that can be waived. */
  initialProduct: string;
  onWaive: (input: { product: string; reason: string }) => Promise<unknown>;
}) {
  const [product, setProduct] = useState(initialProduct);
  return (
    <RoleGate action="payments.waive">
      <ReasonDialog
        trigger="Waive without invoice"
        title="Waive without an invoice"
        confirmLabel="Waive without invoice"
        intro="For a credit or a comp. No invoice number is issued, no PDF is made and nothing is sent to the submitter."
        canSubmit={product !== ""}
        onSubmit={(reason) => onWaive({ product, reason })}
      >
        <Field label="Product">
          {(control) => (
            <select
              {...control}
              value={product}
              onChange={(event) => {
                setProduct(event.target.value);
              }}
            >
              <option value="">Choose a product</option>
              {invoiceProducts.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          )}
        </Field>
      </ReasonDialog>
    </RoleGate>
  );
}
