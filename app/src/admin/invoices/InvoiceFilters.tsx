import { paymentStatuses, paymentStatusLabels } from "../../domain/payments";
import { Field } from "../ui/Field";
import type { InvoiceFilterName } from "./payments-queries";

type Values = Readonly<Partial<Record<InvoiceFilterName, string>>>;

/** The status and overdue filters apply at once. */
export function InvoiceFilters({
  values,
  onChange,
}: {
  values: Values;
  onChange: (next: Values) => void;
}) {
  return (
    <form
      className="admin-toolbar"
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
      }}
    >
      <Field label="Status">
        {(control) => (
          <select
            {...control}
            value={values.status ?? ""}
            onChange={(event) => {
              onChange({ ...values, status: event.target.value });
            }}
          >
            <option value="">All</option>
            {paymentStatuses.map((status) => (
              <option key={status} value={status}>
                {paymentStatusLabels[status]}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="Overdue only">
        {(control) => (
          <input
            {...control}
            type="checkbox"
            checked={values.overdue === "true"}
            onChange={(event) => {
              onChange({ ...values, overdue: event.target.checked ? "true" : "" });
            }}
          />
        )}
      </Field>
    </form>
  );
}
