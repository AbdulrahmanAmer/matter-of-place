import { z } from "zod";
import { variablesByKey } from "../../domain/email.ts";
import { NewsletterBlock } from "../social/NewsletterBlock.tsx";
import { Row } from "./blocks/band.tsx";
import { UNSUBSCRIBE_URL } from "./blocks/footer.tsx";
import { Afternoon } from "./house/afternoon.tsx";
import type { EmailDefinition, EmailProps, TextParts } from "./layout.tsx";
import { GUTTER } from "./style.ts";

export const definition: EmailDefinition = {
  key: "standalone",
  class: "bulk",
  subject: "{{subject}}",
  preheader: "{{preheader}}",
  variables: variablesByKey.standalone,
  blocks: [],
};

// A mail client must never be given a `javascript:` or plain `http:` address, whoever wrote the stored block.
const https = z.string().url().startsWith("https://");

const block = z.object({
  title: z.string().min(1),
  deck: z.string(),
  image_key: z.string().min(1),
  image_url: https,
  link: https,
  alt: z.string().optional(),
});

/**
 * The plain-text part of what `Email` draws from `block`: its words and link before the blocks, the unsubscribe
 * address after the legal lines. Without `block` there is nothing to add.
 */
export function textParts(variables: EmailProps["variables"]): TextParts {
  const given = variables["block"];
  if (given === undefined) return { lead: [], trail: [] };
  const { title, deck, link } = block.parse(given);
  return {
    lead: [title, deck, link].filter((part) => part !== ""),
    trail: [`Unsubscribe: ${UNSUBSCRIBE_URL}`],
  };
}

/**
 * The Campaign email, correspondence on Afternoon's wall: the property block of the `standalone_email` asset
 * (`meta.block`, passed as the variable `block`) hung as a framed print under the door, then the row's own blocks, and
 * the unsubscribe link in the colophon. Without `block` the property block and the link are left out. Both are
 * component code, so `interpolate` never touches them.
 */
export function Email(props: EmailProps) {
  const given = props.variables["block"];
  const parsed = given === undefined ? undefined : block.safeParse(given);
  if (parsed?.success === false) throw new Error("standalone_block_invalid");
  return (
    <Afternoon
      {...props}
      label="A home"
      instrument={
        parsed === undefined ? null : (
          <Row padding={`40px ${String(GUTTER)}px 0`} align="center">
            <NewsletterBlock {...parsed.data} />
          </Row>
        )
      }
      unsubscribe={parsed === undefined ? undefined : UNSUBSCRIBE_URL}
    />
  );
}
