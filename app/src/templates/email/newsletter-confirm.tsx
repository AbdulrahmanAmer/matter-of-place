import { variablesByKey } from "../../domain/email.ts";
import { Threshold } from "./house/threshold.tsx";
import type { EmailDefinition, EmailProps } from "./layout.tsx";

export const definition: EmailDefinition = {
  key: "newsletter_confirm",
  class: "transactional",
  subject: "Confirm your Place Notes subscription",
  preheader: "One click confirms it.",
  variables: variablesByKey.newsletter_confirm,
  blocks: [
    { type: "heading", text: "One click" },
    { type: "heading", text: "to confirm." },
    {
      type: "paragraph",
      text: "Place Notes brings selected homes and stories from California, New York and Florida, about every two weeks.",
    },
    { type: "button", label: "Confirm", url: "{{confirm_url}}" },
    { type: "paragraph", text: "If this was not you, ignore this email and nothing will be sent." },
  ],
};

/** A moment: the door to Place Notes, one click from open. */
export function Email(props: EmailProps) {
  return (
    <Threshold
      {...props}
      label="Place Notes"
      note="This confirms a sign-up made at matterofplace.com."
    />
  );
}
