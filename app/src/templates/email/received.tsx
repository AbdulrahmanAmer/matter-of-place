import { variablesByKey } from "../../domain/email.ts";
import { Threshold } from "./house/threshold.tsx";
import { variable, type EmailDefinition, type EmailProps } from "./layout.tsx";

export const definition: EmailDefinition = {
  key: "received",
  class: "transactional",
  subject: "{{property_address}} is with the editors",
  preheader: "Received, and in review. Review comes before payment.",
  variables: variablesByKey.received,
  blocks: [
    { type: "heading", text: "{{property_address}}" },
    { type: "heading", text: "is with the editors." },
    {
      type: "paragraph",
      text: "Thank you for sending it to us. An editor will read it against our editorial standard, and we will be in touch.",
    },
    {
      type: "facts",
      rows: [
        { label: "Submitted by", value: "{{submitter_name}}" },
        { label: "The home", value: "{{property_address}}, {{city}}, {{state}}" },
        { label: "Package noted", value: "{{package}}" },
      ],
    },
    { type: "heading", text: "How a home is chosen", level: 3 },
    { type: "heading", text: "Review comes before payment.", level: 2 },
    {
      type: "paragraph",
      text: "Editorial consideration is free. Nothing is charged unless the home is accepted and you choose a product.",
    },
    { type: "signature" },
  ],
};

/** A moment: the home passes through the door, then the stack shows it in review. */
export function Email(props: EmailProps) {
  const place = [variable(props.variables, "city"), variable(props.variables, "state")]
    .filter((part) => part !== "")
    .join(" · ");
  return (
    <Threshold
      {...props}
      label="In review"
      place={place}
      stage={{ steps: ["Received.", "In review.", "A decision."], at: 1 }}
      note="This confirms a submission made at matterofplace.com."
    />
  );
}
