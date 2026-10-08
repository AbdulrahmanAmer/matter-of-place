import { invoiceProducts } from "../../domain/payments";
import { Field } from "../ui/Field";

/** The product of an invoice or a waiver, chosen from the price list. */
export function ProductField({
  value,
  onChange,
  hint,
}: {
  value: string;
  onChange: (product: string) => void;
  hint?: string;
}) {
  return (
    <Field label="Product" {...(hint === undefined ? {} : { hint })}>
      {(control) => (
        <select
          {...control}
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
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
  );
}
