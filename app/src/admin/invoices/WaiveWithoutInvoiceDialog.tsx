import { useState } from "react";
import { RoleGate } from "../ui/RoleGate";
import { ProductField } from "./ProductField";
import { ReasonDialog } from "./ReasonDialog";

/** What a Five Features waiver does (W6 item 8, ruling H137): it takes a credit from the contact's ledger. */
const SPENDS_A_CREDIT = "This spends one of the client's Five Features credits.";

/**
 * A Five Features credit or a comp, recorded with no invoice (invariant 12): the product and a reason. No number,
 * no PDF and no email to the submitter. A Five Features waiver spends a credit and is refused when there is none.
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
        <ProductField
          value={product}
          onChange={setProduct}
          {...(product === "Five Features" ? { hint: SPENDS_A_CREDIT } : {})}
        />
      </ReasonDialog>
    </RoleGate>
  );
}
