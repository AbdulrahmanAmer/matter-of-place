import { useState } from "react";
import {
  campaignDaysSchema,
  invoiceSettingsSchema,
  type InvoiceSettings,
} from "../../domain/payments";
import { Field } from "../ui/Field";

const products = campaignDaysSchema.keyof().options;

type Product = (typeof products)[number];

interface Method {
  id: string;
  label: string;
  instructions: string;
}

type TextKey = "prefix" | "due_days" | "billing_email" | "terms" | "late_terms" | "tax_line";

type Draft = Record<TextKey, string> & {
  payment_methods: Method[];
  campaign_days: Readonly<Partial<Record<Product, string>>>;
};

const text = (value: number | null | undefined) => (value == null ? "" : String(value));

function draftOf(invoice: InvoiceSettings | null): Draft {
  return {
    prefix: invoice?.prefix ?? "",
    due_days: text(invoice?.due_days),
    billing_email: invoice?.billing_email ?? "",
    terms: invoice?.terms ?? "",
    late_terms: invoice?.late_terms ?? "",
    tax_line: invoice?.tax_line ?? "",
    payment_methods: invoice?.payment_methods.map((method) => ({ ...method })) ?? [],
    campaign_days: Object.fromEntries(
      products.map((product) => [product, text(invoice?.campaign_days[product])]),
    ),
  };
}

/** A number field: blank is null, which the schema refuses where a number is required. */
const numberOf = (value: string | undefined) =>
  value === undefined || value.trim() === "" ? null : Number(value);

function valueOf(draft: Draft): unknown {
  return {
    ...draft,
    due_days: numberOf(draft.due_days),
    campaign_days: Object.fromEntries(
      products.map((product) => [product, numberOf(draft.campaign_days[product])]),
    ),
  };
}

const scalarFields: { key: TextKey; label: string; hint: string; type?: string; area?: true }[] = [
  {
    key: "prefix",
    label: "Number prefix",
    hint: "2 to 8 capital letters or digits, as in MOP-2026-0001.",
  },
  { key: "due_days", label: "Days to pay", hint: "Counted from the issue date.", type: "number" },
  { key: "billing_email", label: "Billing email", hint: "Shown on every invoice.", type: "email" },
  { key: "terms", label: "Payment terms", hint: "Printed under the total.", area: true },
  { key: "late_terms", label: "Late payment terms", hint: "Printed under the terms.", area: true },
  { key: "tax_line", label: "Tax line", hint: "The tax statement every invoice carries." },
];

/** How invoices are numbered, paid and worded (B6's `invoiceSettingsSchema`), checked here before it is sent. */
export function InvoicingSection({
  invoice,
  pending,
  onSave,
}: {
  invoice: InvoiceSettings | null;
  pending: boolean;
  onSave: (invoice: InvoiceSettings) => void;
}) {
  const [draft, setDraft] = useState(() => draftOf(invoice));
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const errorAt = (key: string) => {
    const error = errors[key];
    return error === undefined ? {} : { error };
  };
  const setMethod = (index: number, next: Partial<Method>) => {
    setDraft({
      ...draft,
      payment_methods: draft.payment_methods.map((method, at) =>
        at === index ? { ...method, ...next } : method,
      ),
    });
  };
  const listError = errors["payment_methods"];
  return (
    <form
      className="admin-fields"
      onSubmit={(event) => {
        event.preventDefault();
        const parsed = invoiceSettingsSchema.safeParse(valueOf(draft));
        if (parsed.success) {
          setErrors({});
          onSave(parsed.data);
          return;
        }
        setErrors(
          Object.fromEntries(
            parsed.error.issues.map((issue) => [issue.path.join("."), issue.message]),
          ),
        );
      }}
    >
      {scalarFields.map((field) => (
        <Field key={field.key} label={field.label} hint={field.hint} {...errorAt(field.key)}>
          {(control) =>
            field.area === true ? (
              <textarea
                {...control}
                rows={3}
                value={draft[field.key]}
                onChange={(event) => {
                  setDraft({ ...draft, [field.key]: event.target.value });
                }}
              />
            ) : (
              <input
                {...control}
                type={field.type ?? "text"}
                value={draft[field.key]}
                onChange={(event) => {
                  setDraft({ ...draft, [field.key]: event.target.value });
                }}
              />
            )
          }
        </Field>
      ))}
      <fieldset>
        <legend>Ways to pay</legend>
        {draft.payment_methods.map((method, index) => {
          const at = `payment_methods.${String(index)}`;
          return (
            <div key={index} className="admin-block">
              <Field label="Method id" hint="Lower case, as in wire." {...errorAt(`${at}.id`)}>
                {(control) => (
                  <input
                    {...control}
                    value={method.id}
                    onChange={(event) => {
                      setMethod(index, { id: event.target.value });
                    }}
                  />
                )}
              </Field>
              <Field label="Method name" {...errorAt(`${at}.label`)}>
                {(control) => (
                  <input
                    {...control}
                    value={method.label}
                    onChange={(event) => {
                      setMethod(index, { label: event.target.value });
                    }}
                  />
                )}
              </Field>
              <Field label="Instructions" {...errorAt(`${at}.instructions`)}>
                {(control) => (
                  <textarea
                    {...control}
                    rows={3}
                    value={method.instructions}
                    onChange={(event) => {
                      setMethod(index, { instructions: event.target.value });
                    }}
                  />
                )}
              </Field>
              <button
                type="button"
                className="admin-button admin-button--quiet"
                onClick={() => {
                  setDraft({
                    ...draft,
                    payment_methods: draft.payment_methods.filter((_, other) => other !== index),
                  });
                }}
              >
                Remove {method.label === "" ? "this method" : method.label}
              </button>
            </div>
          );
        })}
        {listError === undefined ? null : (
          <p className="admin-field__error" role="alert">
            {listError}
          </p>
        )}
        <button
          type="button"
          className="admin-button admin-button--quiet"
          onClick={() => {
            setDraft({
              ...draft,
              payment_methods: [...draft.payment_methods, { id: "", label: "", instructions: "" }],
            });
          }}
        >
          Add a way to pay
        </button>
      </fieldset>
      <fieldset>
        <legend>Campaign days</legend>
        {products.map((product) => (
          <Field
            key={product}
            label={product}
            hint="Blank when the exposure page states no window."
            {...errorAt(`campaign_days.${product}`)}
          >
            {(control) => (
              <input
                {...control}
                type="number"
                min={1}
                step={1}
                value={draft.campaign_days[product] ?? ""}
                onChange={(event) => {
                  setDraft({
                    ...draft,
                    campaign_days: { ...draft.campaign_days, [product]: event.target.value },
                  });
                }}
              />
            )}
          </Field>
        ))}
      </fieldset>
      <button type="submit" className="admin-button" disabled={pending}>
        Save invoicing
      </button>
    </form>
  );
}
