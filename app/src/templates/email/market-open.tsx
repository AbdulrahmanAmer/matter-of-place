import { variablesByKey } from "../../domain/email.ts";
import { Message } from "./blocks.tsx";
import type { EmailDefinition } from "./layout.tsx";

// The one notice an interest signup receives when its market opens (B11 invariant 14, G15). Seeded as the
// `market_open` row by B11's newsletter migration; the `market_open_notice` job renders the row, never this file.
export const definition: EmailDefinition = {
  key: "market_open",
  class: "bulk",
  subject: "Matter of Place now publishes in {{market_name}}",
  preheader: "The first property is on the site.",
  variables: variablesByKey.market_open,
  blocks: [
    { type: "heading", text: "{{market_name}} is open." },
    {
      type: "paragraph",
      text: "You asked to hear when Matter of Place publishes its first property in {{market_name}}. It is on the site now.",
    },
    { type: "button", label: "See {{market_name}}", url: "{{market_url}}" },
    {
      type: "paragraph",
      text: "This is the one message we promised. Place Notes, our fortnightly letter, is a separate sign-up on the site.",
    },
  ],
};

export const Email = Message;
