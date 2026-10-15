import { variablesByKey } from "../../domain/email.ts";
import { Threshold } from "./house/threshold.tsx";
import type { EmailDefinition, EmailProps } from "./layout.tsx";

export const definition: EmailDefinition = {
  key: "awaiting_assets",
  class: "transactional",
  subject: "A little more for {{property_address}}",
  preheader: "To continue the review, we need a few more materials.",
  variables: variablesByKey.awaiting_assets,
  blocks: [
    { type: "heading", text: "{{property_address}}" },
    { type: "heading", text: "needs a little more." },
    { type: "paragraph", text: "To continue with {{property_address}} we need the following." },
    { type: "paragraph", text: "{{assets_note}}" },
    { type: "paragraph", text: "Reply to this email with the files or a link." },
    { type: "signature" },
  ],
};

/** A moment: the review waits on the sender, and the stack says so. */
export function Email(props: EmailProps) {
  return (
    <Threshold
      {...props}
      label="Awaiting material"
      stage={{ steps: ["Received.", "A little more.", "A decision."], at: 1 }}
      note="This concerns a submission made at matterofplace.com."
    />
  );
}
