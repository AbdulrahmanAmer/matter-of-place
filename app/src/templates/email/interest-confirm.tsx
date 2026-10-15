import { variablesByKey } from "../../domain/email.ts";
import { Threshold } from "./house/threshold.tsx";
import { variable, type EmailDefinition, type EmailProps } from "./layout.tsx";

export const definition: EmailDefinition = {
  key: "interest_confirm",
  class: "transactional",
  subject: "Confirm your interest in {{market_names}}",
  preheader: "One click confirms it.",
  variables: variablesByKey.interest_confirm,
  blocks: [
    { type: "heading", text: "One click" },
    { type: "heading", text: "to confirm." },
    {
      type: "paragraph",
      text: "You asked to hear when Matter of Place publishes its first home in {{market_names}}.",
    },
    { type: "button", label: "Confirm", url: "{{confirm_url}}" },
    { type: "paragraph", text: "If this was not you, ignore this email and nothing will be sent." },
  ],
};

/** A moment: the door to a market, one click from open. */
export function Email(props: EmailProps) {
  return (
    <Threshold
      {...props}
      label="Coming soon"
      place={variable(props.variables, "market_names")}
      note="This confirms a request made at matterofplace.com."
    />
  );
}
