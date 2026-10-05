import { variablesByKey } from "../../domain/email.ts";
import { Message } from "./blocks.tsx";
import type { EmailDefinition } from "./layout.tsx";

export const definition: EmailDefinition = {
  key: "standalone",
  class: "bulk",
  subject: "Matter of Place",
  preheader: "",
  variables: variablesByKey.standalone,
  blocks: [
    {
      type: "paragraph",
      text: "The Campaign email of a property is written for that property before it is sent.",
    },
  ],
};

export const Email = Message;
