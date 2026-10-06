import { variablesByKey } from "../../domain/email.ts";
import { Message } from "./blocks.tsx";
import type { EmailDefinition } from "./layout.tsx";

export const definition: EmailDefinition = {
  key: "invoice",
  class: "transactional",
  subject: "Invoice {{invoice_number}} from Matter of Place",
  preheader: "",
  variables: variablesByKey.invoice,
  blocks: [
    { type: "heading", text: "Invoice {{invoice_number}}" },
    {
      type: "facts",
      rows: [
        { label: "Property", value: "{{property_address}}" },
        { label: "Product", value: "{{product}}" },
        { label: "Amount", value: "{{amount}}" },
        { label: "Terms", value: "{{terms}}" },
        { label: "Preferred payment method", value: "{{preferred_method}}" },
      ],
    },
    { type: "paragraph", text: "How to pay" },
    { type: "paragraph", text: "{{payment_instructions}}" },
    {
      type: "paragraph",
      text: "Your property is scheduled once payment is confirmed. The invoice is attached.",
    },
    { type: "paragraph", text: "Questions about this invoice: {{billing_email}}." },
    { type: "signature" },
  ],
};

export const Email = Message;
