import { variablesByKey } from "../../domain/email.ts";
import { Afternoon } from "./house/afternoon.tsx";
import type { EmailDefinition, EmailProps } from "./layout.tsx";

export const definition: EmailDefinition = {
  key: "repermission",
  class: "bulk",
  subject: "Do you still want Place Notes?",
  preheader: "One click keeps you on the list.",
  variables: variablesByKey.repermission,
  blocks: [
    { type: "heading", text: "Still reading?" },
    {
      type: "paragraph",
      text: "It has been a year since you confirmed or last clicked a link in Place Notes.",
    },
    { type: "paragraph", text: "If you would like to keep receiving it, confirm below." },
    { type: "button", label: "Keep me subscribed", url: "{{confirm_url}}" },
    {
      type: "paragraph",
      text: "If we do not hear from you, we will remove you from the list. You can subscribe again at any time.",
    },
  ],
};

/** A one-to-one email is not a broadcast, so Resend fills no unsubscribe page: the link writes to the house. */
const unsubscribeHref = (address: string | null): string | undefined =>
  address === null ? undefined : `mailto:${address}?subject=Unsubscribe`;

/** Correspondence: a short letter asking once whether to keep writing. */
export function Email(props: EmailProps) {
  return (
    <Afternoon
      {...props}
      label="Place Notes"
      unsubscribe={unsubscribeHref(props.site.contact.email)}
    />
  );
}
