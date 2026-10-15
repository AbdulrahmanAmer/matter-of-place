import { variablesByKey } from "../../domain/email.ts";
import { Threshold } from "./house/threshold.tsx";
import type { EmailDefinition, EmailProps } from "./layout.tsx";

export const definition: EmailDefinition = {
  key: "inquiry_ack",
  class: "transactional",
  subject: "We have your message",
  preheader: "A person will reply within one working day.",
  variables: variablesByKey.inquiry_ack,
  blocks: [
    { type: "heading", text: "Your message" },
    { type: "heading", text: "is with us." },
    {
      type: "paragraph",
      text: "Thank you, {{name}}. A person will reply within one working day.",
    },
    { type: "signature" },
  ],
};

/** A moment: a message has arrived. */
export function Email(props: EmailProps) {
  return (
    <Threshold
      {...props}
      label="Received"
      note="This confirms a message sent at matterofplace.com."
    />
  );
}
