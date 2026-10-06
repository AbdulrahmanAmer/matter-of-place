import { variablesByKey } from "../../domain/email.ts";
import { Message } from "./blocks.tsx";
import type { EmailDefinition } from "./layout.tsx";

export const definition: EmailDefinition = {
  key: "declined",
  class: "transactional",
  subject: "About {{property_address}}",
  preheader: "",
  variables: variablesByKey.declined,
  blocks: [
    { type: "heading", text: "Thank you for submitting {{property_address}}." },
    {
      type: "paragraph",
      text: "After careful reading, we will not be featuring this property at this time.",
    },
    { type: "paragraph", text: "{{reason_paragraph}}" },
    { type: "paragraph", text: "{{note_paragraph}}" },
    {
      type: "paragraph",
      text: "You have not been charged. You are welcome to submit another property.",
    },
    { type: "signature" },
  ],
};

export const Email = Message;
