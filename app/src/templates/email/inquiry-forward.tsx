import { variablesByKey } from "../../domain/email.ts";
import { Light } from "./house/light.tsx";
import type { EmailDefinition, EmailProps } from "./layout.tsx";

export const definition: EmailDefinition = {
  key: "inquiry_forward",
  class: "transactional",
  subject: "A message about {{property_title}}",
  preheader: "Sent through Matter of Place.",
  variables: variablesByKey.inquiry_forward,
  blocks: [
    { type: "heading", text: "A message about {{property_title}}" },
    { type: "paragraph", text: "{{inquirer_name}} wrote to you through Matter of Place:" },
    { type: "paragraph", text: "{{message}}" },
    {
      type: "facts",
      rows: [
        { label: "From", value: "{{inquirer_name}}" },
        { label: "Reach them at", value: "{{inquirer_contact}}" },
      ],
    },
    {
      type: "paragraph",
      text: "Matter of Place passes the message on and does not take part in the conversation.",
    },
    { type: "signature" },
  ],
};

/** Internal in kind: a forwarded message, read and answered quickly. */
export function Email(props: EmailProps) {
  return (
    <Light
      {...props}
      label="An inquiry"
      note="Forwarded because this home was published from your submission."
    />
  );
}
