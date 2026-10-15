import { variablesByKey } from "../../domain/email.ts";
import { Light } from "./house/light.tsx";
import type { EmailDefinition, EmailProps } from "./layout.tsx";

// B10 step 9 (G22): the weekly report of a campaign, sent to the person who submitted the property from `/admin` ›
// Reports. It states numbers only. The seed copy is reviewed in the admin editor after the first build (S45).
export const definition: EmailDefinition = {
  key: "campaign_report",
  class: "transactional",
  subject: "{{property_name}}: the week of {{period}}",
  preheader: "Reach, views and visits from Matter of Place",
  variables: variablesByKey.campaign_report,
  blocks: [
    { type: "heading", text: "{{property_name}}" },
    { type: "paragraph", text: "The week of {{period}}." },
    {
      type: "facts",
      rows: [
        { label: "Impressions", value: "{{impressions}}" },
        { label: "Reach", value: "{{reach}}" },
        { label: "Visits from social links", value: "{{clicks}}" },
        { label: "Video views", value: "{{video_views}}" },
        { label: "Click-through rate", value: "{{ctr}}" },
      ],
    },
    {
      type: "paragraph",
      text: "Visits are counted on matterofplace.com from the links we posted. The platforms report the other figures.",
    },
    { type: "signature" },
  ],
};

/** Internal in kind: a week of numbers, read at a glance. */
export function Email(props: EmailProps) {
  return <Light {...props} label="Weekly report" note="Sent for a campaign of Matter of Place." />;
}
