import { variablesByKey } from "../../domain/email.ts";
import { Message } from "./blocks.tsx";
import type { EmailDefinition } from "./layout.tsx";

export const definition: EmailDefinition = {
  key: "newsletter_confirm",
  class: "transactional",
  subject: "Confirm your Place Notes subscription",
  preheader: "",
  variables: variablesByKey.newsletter_confirm,
  blocks: [
    { type: "heading", text: "One click to confirm." },
    {
      type: "paragraph",
      text: "Place Notes brings selected properties and stories from California, New York and Florida, about every two weeks.",
    },
    { type: "button", label: "Confirm", url: "{{confirm_url}}" },
    { type: "paragraph", text: "If this was not you, ignore this email and nothing will be sent." },
  ],
};

export const Email = Message;
