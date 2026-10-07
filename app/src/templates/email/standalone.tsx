import { z } from "zod";
import { variablesByKey } from "../../domain/email.ts";
import { NewsletterBlock } from "../social/NewsletterBlock.tsx";
import { Blocks } from "./blocks.tsx";
import { Layout, type EmailDefinition, type EmailProps } from "./layout.tsx";

export const definition: EmailDefinition = {
  key: "standalone",
  class: "bulk",
  subject: "Matter of Place",
  preheader: "",
  variables: variablesByKey.standalone,
  blocks: [
    {
      type: "paragraph",
      text: "The Campaign email of a property is written for that property before it is sent.",
    },
  ],
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
 * The Campaign email: the property block of the `standalone_email` asset (`meta.block`, passed as the variable
 * `block`), then the row's own blocks. Without `block` (the sample renders) the property block is left out.
 */
export function Email({ title, preheader, blocks, site, variables }: EmailProps) {
  const given = variables["block"];
  const parsed = given === undefined ? undefined : block.safeParse(given);
  if (parsed?.success === false) throw new Error("standalone_block_invalid");
  return (
    <Layout title={title} preheader={preheader} site={site}>
      {parsed === undefined ? null : <NewsletterBlock {...parsed.data} />}
      <Blocks blocks={blocks} />
    </Layout>
  );
}
