import { variablesByKey } from "../../domain/email.ts";
import { Afternoon } from "./house/afternoon.tsx";
import type { EmailDefinition, EmailProps } from "./layout.tsx";

export const definition: EmailDefinition = {
  key: "declined",
  class: "transactional",
  subject: "About {{property_address}}",
  preheader: "Our decision, and the reason for it.",
  variables: variablesByKey.declined,
  blocks: [
    { type: "heading", text: "{{property_address}}" },
    { type: "heading", text: "after careful reading" },
    {
      type: "paragraph",
      text: "Thank you for sending it to us. We will not be featuring this home at this time.",
    },
    { type: "paragraph", text: "{{reason_paragraph}}" },
    { type: "paragraph", text: "{{note_paragraph}}" },
    { type: "heading", text: "You have not been charged.", level: 2 },
    { type: "paragraph", text: "You are welcome to submit another home." },
    { type: "signature" },
  ],
};

/** Correspondence: a letter from the editors, set on the wall. */
export function Email(props: EmailProps) {
  return (
    <Afternoon
      {...props}
      label="From the editors"
      note="This answers a submission made at matterofplace.com."
    />
  );
}
