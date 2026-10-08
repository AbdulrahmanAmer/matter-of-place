import { useState } from "react";
import { RoleGate } from "../ui/RoleGate";
import { ProductField } from "./ProductField";
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
        <ProductField value={product} onChange={setProduct} />
      </ReasonDialog>
    </RoleGate>
  );
}
