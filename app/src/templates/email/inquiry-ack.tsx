import { variablesByKey } from "../../domain/email.ts";
import { Message } from "./blocks.tsx";
import type { EmailDefinition } from "./layout.tsx";

export const definition: EmailDefinition = {
  key: "inquiry_ack",
  class: "transactional",
  subject: "We have your message",
  preheader: "",
  variables: variablesByKey.inquiry_ack,
  blocks: [
    { type: "heading", text: "Thank you, {{name}}." },
    { type: "paragraph", text: "A person will reply within one working day." },
    { type: "signature" },
  ],
};

export const Email = Message;
