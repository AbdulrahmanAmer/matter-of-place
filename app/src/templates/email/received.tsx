import { variablesByKey } from "../../domain/email.ts";
import { Message } from "./blocks.tsx";
import type { EmailDefinition } from "./layout.tsx";

export const definition: EmailDefinition = {
  key: "received",
  class: "transactional",
  subject: "We have your submission",
  preheader: "We will review it and be in touch.",
  variables: variablesByKey.received,
  blocks: [
    { type: "heading", text: "Thank you, {{submitter_name}}." },
    {
      type: "paragraph",
      text: "We have received {{property_address}}, {{city}}, {{state}}. We will review it against our editorial standard and be in touch.",
    },
    {
      type: "paragraph",
      text: "Editorial consideration is free. Nothing is charged unless the property is accepted and you choose a product.",
    },
    { type: "signature" },
  ],
};

export const Email = Message;
