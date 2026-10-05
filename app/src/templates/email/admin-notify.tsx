import { variablesByKey } from "../../domain/email.ts";
import { Message } from "./blocks.tsx";
import type { EmailDefinition } from "./layout.tsx";

export const definition: EmailDefinition = {
  key: "admin_notify",
  class: "alert",
  subject: "{{headline}}",
  preheader: "",
  variables: variablesByKey.admin_notify,
  blocks: [
    { type: "heading", text: "{{headline}}" },
    { type: "paragraph", text: "{{summary}}" },
    { type: "button", label: "Open in admin", url: "{{link_url}}" },
  ],
};

export const Email = Message;
