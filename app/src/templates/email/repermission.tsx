import { variablesByKey } from "../../domain/email.ts";
import { Message } from "./blocks.tsx";
import type { EmailDefinition } from "./layout.tsx";

export const definition: EmailDefinition = {
  key: "repermission",
  class: "bulk",
  subject: "Do you still want Place Notes?",
  preheader: "One click keeps you on the list.",
  variables: variablesByKey.repermission,
  blocks: [
    { type: "heading", text: "Still reading?" },
    {
      type: "paragraph",
      text: "It has been a year since you confirmed or last clicked a link in Place Notes.",
    },
    { type: "paragraph", text: "If you would like to keep receiving it, confirm below." },
    { type: "button", label: "Keep me subscribed", url: "{{confirm_url}}" },
    {
      type: "paragraph",
      text: "If we do not hear from you, we will remove you from the list. You can subscribe again at any time.",
    },
  ],
};

export const Email = Message;
