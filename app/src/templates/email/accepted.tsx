import { variablesByKey } from "../../domain/email.ts";
import { Message } from "./blocks.tsx";
import type { EmailDefinition } from "./layout.tsx";

export const definition: EmailDefinition = {
  key: "accepted",
  class: "transactional",
  subject: "{{property_address}} has been accepted",
  preheader: "",
  variables: variablesByKey.accepted,
  blocks: [
    { type: "heading", text: "Your property has been selected." },
    {
      type: "paragraph",
      text: "We would be glad to feature {{property_address}}, {{city}}, {{state}}.",
    },
    {
      type: "paragraph",
      text: "An invoice for {{package}} will follow. Once payment is confirmed we schedule the property.",
    },
    { type: "signature" },
  ],
};

export const Email = Message;
