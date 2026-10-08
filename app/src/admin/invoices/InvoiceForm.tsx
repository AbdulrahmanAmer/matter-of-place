import { useId, useState, type ReactNode } from "react";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { Field } from "../ui/Field";
import { RoleGate } from "../ui/RoleGate";
import { ProductField } from "./ProductField";
import { useSubmit } from "./use-submit";

const settingLabels: Readonly<Record<string, string>> = {
  "legal.entity": "The legal entity",
  "legal.address": "The legal address",
  "contact.email": "The contact email",
  invoice: "The invoice settings",
  "payment_methods.instructions": "Instructions for at least one payment method",
  terms: "The payment terms",
  late_terms: "The late payment terms",
  tax_line: "The tax line",
};

/** The id pattern of a payment method, as `settings.invoice` keeps it. */
const METHOD_ID = "[a-z][a-z0-9_]{0,39}";

/**
 * The draft of an invoice: the product and the preferred payment method. The amount is not here: the server prices
 * the product when the invoice is issued. `missing` lists the settings the server refused to issue without; Issue
 * stays off while it is not empty. `children` sit beside Issue.
 */
export function InvoiceForm({
  initialProduct,
  canIssue,
  missing,
  onIssue,
  children,
}: {
  /** The package the request chose, or empty when it chose none that can be invoiced. */
  initialProduct: string;
  /** The request is accepted and has no live invoice (invariant 1). */
  canIssue: boolean;
  missing: readonly string[];
  onIssue: (input: { product: string; preferredMethod: string }) => Promise<unknown>;
  children?: ReactNode;
}) {
  const [product, setProduct] = useState(initialProduct);
  const [method, setMethod] = useState("");
  const [confirming, setConfirming] = useState(false);
  const close = () => {
    setConfirming(false);
  };
  const { pending, error, submit } = useSubmit(onIssue, close);
  const formId = useId();
  const ready = canIssue && missing.length === 0 && product !== "" && method !== "";

  return (
    <>
      <form
        id={formId}
        className="admin-invoice-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (ready) setConfirming(true);
        }}
      >
        <ProductField
          value={product}
          onChange={setProduct}
          hint="The amount is set from the price list when the invoice is issued."
        />
        <Field
          label="Preferred payment method"
          hint="The id of one method in the invoice settings, for example bank_transfer."
        >
          {(control) => (
            <input
              {...control}
              type="text"
              pattern={METHOD_ID}
              maxLength={40}
              value={method}
              onChange={(event) => {
                setMethod(event.target.value.trim());
              }}
            />
          )}
        </Field>
        {canIssue ? null : <p role="status">Accept this request before issuing an invoice.</p>}
        {missing.length === 0 ? null : (
          <section aria-label="Before this invoice can be issued">
            <p>Before this invoice can be issued, set:</p>
            <ul className="admin-readiness">
              {missing.map((name) => (
                <li key={name}>{settingLabels[name] ?? name}</li>
              ))}
            </ul>
            <p>Reload this page once they are saved.</p>
          </section>
        )}
      </form>
      <div className="admin-actions" data-print="hide">
        <RoleGate action="payments.issue">
          <button type="submit" form={formId} className="admin-button" disabled={!ready}>
            Issue and email
          </button>
        </RoleGate>
        {children}
      </div>
      <ConfirmDialog
        open={confirming}
        title="Issue and email this invoice"
        confirmLabel="Issue and email"
        pending={pending}
        onConfirm={() => {
          void submit({ product, preferredMethod: method });
        }}
        onCancel={close}
      >
        <p>The invoice is numbered, made as a PDF and emailed to the submitter.</p>
        {error === null ? null : <p role="alert">{error}</p>}
      </ConfirmDialog>
    </>
  );
}
