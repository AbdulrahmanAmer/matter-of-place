import { Hr } from "@react-email/components";
import type { CSSProperties } from "react";
import type { SiteContext } from "../../server/email/context.ts";
import { NewsletterBlock, type NewsletterBlockProps } from "../social/NewsletterBlock.tsx";
import { themeHex } from "../theme.gen.ts";
import { Unsubscribe } from "./blocks/footer.tsx";
import { Intro } from "./blocks/intro.tsx";
import { Masthead } from "./blocks/masthead.tsx";
import { Story } from "./blocks/story.tsx";
import { Layout } from "./layout.tsx";

// The Place Notes issue, in the shell every email shares (`Layout`): the issue head, the blocks in reading order, and
// the unsubscribe link on the footer band. Colours come from `theme.gen.ts` (G-007).
// Every address arrives finished, with its UTM set (`render.ts`); a component only draws.

/** One block of an issue, ready to draw. A property block is B9's `NewsletterBlock` under the line a person wrote. */
export type IssueBlockView =
  | { type: "intro"; id: string; text: string }
  | {
      type: "story";
      id: string;
      title: string;
      deck: string;
      text: string | undefined;
      href: string;
    }
  | ({ type: "property"; id: string; text: string | undefined } & NewsletterBlockProps);

export interface PlaceNotesProps {
  title: string;
  preheader: string;
  number: number;
  blocks: readonly IssueBlockView[];
  site: SiteContext;
}

const rule: CSSProperties = {
  margin: "36px 0",
  border: 0,
  borderTop: `1px solid ${themeHex.accent}`,
};

function BlockView({ block }: { block: IssueBlockView }) {
  switch (block.type) {
    case "intro":
      return <Intro text={block.text} />;
    case "story":
      return <Story title={block.title} deck={block.deck} text={block.text} href={block.href} />;
    case "property":
      return (
        <>
          {block.text === undefined ? null : <Intro text={block.text} />}
          <NewsletterBlock
            title={block.title}
            deck={block.deck}
            image_key={block.image_key}
            image_url={block.image_url}
            link={block.link}
            alt={block.alt}
          />
        </>
      );
  }
}

export function PlaceNotes({ title, preheader, number, blocks, site }: PlaceNotesProps) {
  return (
    <Layout title={title} preheader={preheader} site={site} afterFooter={<Unsubscribe />}>
      <Masthead number={number} />
      {blocks.map((block) => (
        <div key={block.id}>
          <Hr style={rule} />
          <BlockView block={block} />
        </div>
      ))}
    </Layout>
  );
}
