import { variablesByKey } from "../../domain/email.ts";
import { Threshold } from "./house/threshold.tsx";
import type { EmailDefinition, EmailProps } from "./layout.tsx";

// W6 item 7, ruling H119 (4): the client's sign-in link. The job that sends it makes the link when it runs, so the
// token is never stored; the link opens `/account/confirm` with the token in its fragment, which no server receives.
export const definition: EmailDefinition = {
  key: "account_link",
  class: "transactional",
  subject: "Your link to sign in to Matter of Place",
  preheader: "It works once and for one hour.",
  variables: variablesByKey.account_link,
  blocks: [
    { type: "heading", text: "Your account" },
    { type: "heading", text: "is one step away." },
    {
      type: "paragraph",
      text: "Use the button below to sign in and see the requests you have sent us. The link works once and for one hour.",
    },
    { type: "button", label: "Sign in", url: "{{sign_in_url}}" },
    {
      type: "paragraph",
      text: "If you did not ask for it, ignore this email and nothing will change.",
    },
  ],
};

/** A moment: the door to the client's own room. */
export function Email(props: EmailProps) {
  return (
    <Threshold
      {...props}
      label="Your account"
      note="Sent because a sign-in link was asked for at matterofplace.com."
    />
  );
}
