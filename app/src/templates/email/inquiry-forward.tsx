import { variablesByKey } from "../../domain/email.ts";
import { Message } from "./blocks.tsx";
import type { EmailDefinition } from "./layout.tsx";

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
    { type: "paragraph", text: "You can reach them at {{inquirer_contact}}." },
    {
      type: "paragraph",
      text: "Matter of Place passes the message on and does not take part in the conversation.",
    },
    { type: "signature" },
  ],
};

export const Email = Message;
