import type { SiteContext } from "../../server/email/context.ts";
import { NewsletterBlock, type NewsletterBlockProps } from "../social/NewsletterBlock.tsx";
import { Unsubscribe } from "./blocks/footer.tsx";
import { Intro } from "./blocks/intro.tsx";
import { Masthead } from "./blocks/masthead.tsx";
import { Rule } from "./blocks/rule.tsx";
import { Story } from "./blocks/story.tsx";
import { Layout } from "./layout.tsx";

// The Place Notes issue, in the shell every email shares (`Layout`): the nameplate, the blocks in reading order with a
// Sandstone hairline between them, and the unsubscribe link on the footer band. Colours come from `theme.gen.ts`
// (G-007). Every address arrives finished, with its UTM set (`render.ts`); a component only draws.

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
      <div className="mop-follow">
        {blocks.map((block, index) => (
          <div key={block.id}>
            {/* An opening intro reads on from the nameplate; every piece after it starts under a hairline. */}
            {index === 0 && block.type === "intro" ? (
              <div style={{ height: "30px", lineHeight: "30px", fontSize: "1px" }}>&nbsp;</div>
            ) : (
              <Rule padding="38px 0 38px" />
            )}
            <BlockView block={block} />
          </div>
        ))}
      </div>
    </Layout>
  );
}
