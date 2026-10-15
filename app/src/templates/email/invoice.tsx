import { variablesByKey } from "../../domain/email.ts";
import { Ledger } from "./blocks/ledger.tsx";
import { Afternoon } from "./house/afternoon.tsx";
import { variable, type EmailDefinition, type EmailProps, type TextParts } from "./layout.tsx";

export const definition: EmailDefinition = {
  key: "invoice",
  class: "transactional",
  subject: "Invoice {{invoice_number}} from Matter of Place",
  preheader: "{{amount}} for {{product}}, {{property_address}}. Due {{due_date}}.",
  variables: variablesByKey.invoice,
  blocks: [
    { type: "heading", text: "{{product}}" },
    { type: "heading", text: "for {{property_address}}" },
    {
      type: "facts",
      rows: [
        { label: "Issued", value: "{{issue_date}}" },
        { label: "Due", value: "{{due_date}}" },
        { label: "Terms", value: "{{terms}}" },
        { label: "Preferred method", value: "{{preferred_method}}" },
      ],
    },
    { type: "heading", text: "How to pay", level: 3 },
    { type: "paragraph", text: "{{payment_instructions}}" },
    { type: "heading", text: "Your home is scheduled once payment is confirmed.", level: 2 },
    {
      type: "paragraph",
      text: "The invoice is attached. Questions about it: {{billing_email}}.",
    },
    { type: "signature" },
  ],
};

const amounts = (variables: EmailProps["variables"]) => ({
  number: variable(variables, "invoice_number"),
  item: variable(variables, "product"),
  home: variable(variables, "property_address"),
  amount: variable(variables, "amount"),
});

/** The amounts in the plain-text part, before the row's words, as the HTML sets them under the placard. */
export function textParts(variables: EmailProps["variables"]): TextParts {
  const { number, item, home, amount } = amounts(variables);
  return {
    lead: [`Invoice ${number}`, `${item}, ${home}: ${amount}`, `Total due: ${amount}`],
    trail: [],
  };
}

/** Correspondence: a gallery's price label made exact, the amounts in Proof's ledger on Afternoon's axis. */
export function Email(props: EmailProps) {
  const { number, item, home, amount } = amounts(props.variables);
  const to = variable(props.variables, "submitter_name");
  return (
    <Afternoon
      {...props}
      label={`Invoice ${number}`}
      instrument={<Ledger item={item} detail={home} amount={amount} />}
      note={`Invoice ${number} for ${home}, sent to ${to}. The invoice is attached.`}
    />
  );
}
