import { variablesByKey } from "../../domain/email.ts";
import { Message } from "./blocks.tsx";
import type { EmailDefinition } from "./layout.tsx";

export const definition: EmailDefinition = {
  key: "subject_ack",
  class: "transactional",
  subject: "We have your privacy request",
  preheader: "We will answer by {{due_date}}.",
  variables: variablesByKey.subject_ack,
  blocks: [
    { type: "heading", text: "We have your request." },
    {
      type: "paragraph",
      text: "We received your {{kind_label}} request and will answer by {{due_date}}, within 45 days of receiving it.",
    },
    { type: "paragraph", text: "To confirm it is you, we may ask you to reply from this address." },
    { type: "signature" },
  ],
};

export const Email = Message;
