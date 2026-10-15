import { variablesByKey } from "../../domain/email.ts";
import { Afternoon } from "./house/afternoon.tsx";
import type { EmailDefinition, EmailProps } from "./layout.tsx";

export const definition: EmailDefinition = {
  key: "subject_ack",
  class: "transactional",
  subject: "We have your privacy request",
  preheader: "We will answer by {{due_date}}.",
  variables: variablesByKey.subject_ack,
  blocks: [
    { type: "heading", text: "Your {{kind_label}} request" },
    { type: "heading", text: "is with us" },
    {
      type: "paragraph",
      text: "We received your {{kind_label}} request and will answer by {{due_date}}, within 45 days of receiving it.",
    },
    { type: "paragraph", text: "To confirm it is you, we may ask you to reply from this address." },
    { type: "signature" },
  ],
};

/** Correspondence: an answer about a person's own data, plainly dated. */
export function Email(props: EmailProps) {
  return (
    <Afternoon
      {...props}
      label="Privacy"
      note="This confirms a privacy request made at matterofplace.com."
    />
  );
}
