import { variablesByKey } from "../../domain/email.ts";
import { Message } from "./blocks.tsx";
import type { EmailDefinition } from "./layout.tsx";

export const definition: EmailDefinition = {
  key: "interest_confirm",
  class: "transactional",
  subject: "Confirm your interest in {{market_names}}",
  preheader: "",
  variables: variablesByKey.interest_confirm,
  blocks: [
    { type: "heading", text: "Confirm your interest." },
    {
      type: "paragraph",
      text: "You asked to hear when Matter of Place publishes its first property in {{market_names}}.",
    },
    { type: "button", label: "Confirm", url: "{{confirm_url}}" },
    { type: "paragraph", text: "If this was not you, ignore this email and nothing will be sent." },
  ],
};

export const Email = Message;
