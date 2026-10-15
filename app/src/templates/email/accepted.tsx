import { variablesByKey } from "../../domain/email.ts";
import { Threshold } from "./house/threshold.tsx";
import { cityState, type EmailDefinition, type EmailProps } from "./layout.tsx";

export const definition: EmailDefinition = {
  key: "accepted",
  class: "transactional",
  subject: "{{property_address}} is accepted",
  preheader: "An invoice follows. We schedule the home once payment is confirmed.",
  variables: variablesByKey.accepted,
  blocks: [
    { type: "heading", text: "{{property_address}}" },
    { type: "heading", text: "is accepted." },
    {
      type: "paragraph",
      text: "We would be glad to feature {{property_address}}, {{city}}, {{state}}.",
    },
    {
      type: "paragraph",
      text: "An invoice for {{package}} will follow. Once payment is confirmed, we schedule the home.",
    },
    { type: "heading", text: "How a home is chosen", level: 3 },
    { type: "heading", text: "Acceptance is not for sale.", level: 2 },
    {
      type: "paragraph",
      text: "The decision is made first, on the home alone. Payment follows it, never the other way.",
    },
    { type: "signature" },
  ],
};

/** A moment: the door opens on the decision, and the stack ends on it. */
export function Email(props: EmailProps) {
  return (
    <Threshold
      {...props}
      label="Accepted"
      place={cityState(props.variables)}
      stage={{ steps: ["Received.", "Reviewed.", "Accepted."], at: 2 }}
      note="This answers a submission made at matterofplace.com."
    />
  );
}
