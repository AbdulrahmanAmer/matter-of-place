import { variablesByKey } from "../../domain/email.ts";
import { Message } from "./blocks.tsx";
import type { EmailDefinition } from "./layout.tsx";

export const definition: EmailDefinition = {
  key: "awaiting_assets",
  class: "transactional",
  subject: "Materials for {{property_address}}",
  preheader: "",
  variables: variablesByKey.awaiting_assets,
  blocks: [
    { type: "heading", text: "A little more, please." },
    { type: "paragraph", text: "To continue with {{property_address}} we need the following." },
    { type: "paragraph", text: "{{assets_note}}" },
    { type: "paragraph", text: "Reply to this email with the files or a link." },
    { type: "signature" },
  ],
};

export const Email = Message;
