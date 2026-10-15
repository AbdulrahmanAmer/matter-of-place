import { variablesByKey } from "../../domain/email.ts";
import { Light } from "./house/light.tsx";
import type { EmailDefinition, EmailProps } from "./layout.tsx";

export const definition: EmailDefinition = {
  key: "admin_notify",
  class: "alert",
  subject: "{{headline}}",
  preheader: "",
  variables: variablesByKey.admin_notify,
  blocks: [
    { type: "heading", text: "{{headline}}" },
    { type: "paragraph", text: "{{summary}}" },
    { type: "button", label: "Open in admin", url: "{{link_url}}" },
  ],
};

/** Internal: an alert the team reads several times a day, quick to read. */
export function Email(props: EmailProps) {
  return (
    <Light {...props} label="For the team" note="Sent to the team by the Matter of Place admin." />
  );
}
