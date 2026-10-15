import type { SiteContext } from "../../server/email/context.ts";
import { NewsletterBlock, type NewsletterBlockProps } from "../social/NewsletterBlock.tsx";
import { Row } from "./blocks/band.tsx";
import { UNSUBSCRIBE_URL } from "./blocks/footer.tsx";
import { Intro } from "./blocks/intro.tsx";
import { Masthead } from "./blocks/masthead.tsx";
import { Story } from "./blocks/story.tsx";
import { Afternoon } from "./house/afternoon.tsx";
import { GUTTER, hairline, ink } from "./style.ts";

// The Place Notes issue, correspondence on Afternoon's wall (operator, 2026-10-15): the door, the nameplate as its
// placard, then the blocks in reading order on the centre axis with a short Sandstone hairline between them, and the
// unsubscribe link in the colophon. Every address arrives finished, with its UTM set (`render.ts`); a component only
// draws.

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

const table = { role: "presentation", cellPadding: 0, cellSpacing: 0, border: 0 } as const;

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

/** The short hairline that parts two pieces on the axis. */
function Parting() {
  return (
    <table {...table} align="center" style={{ margin: "0 auto 40px" }}>
      <tbody>
        <tr>
          <td className="mop-hair" width={24} style={{ ...hairline(ink.sandstone), width: "24px" }}>
            &nbsp;
          </td>
        </tr>
      </tbody>
    </table>
  );
}

export function PlaceNotes({ title, preheader, number, blocks, site }: PlaceNotesProps) {
  return (
    <Afternoon
      title={title}
      preheader={preheader}
      site={site}
      blocks={[]}
      variables={{}}
      placard={<Masthead number={number} />}
      after={blocks.map((block, index) => (
        <Row
          key={block.id}
          padding={`${index === 0 ? "40px" : "8px"} ${String(GUTTER)}px 32px`}
          align="center"
        >
          {/* An opening intro reads on from the nameplate; every piece after it starts under a hairline. */}
          {index === 0 ? null : <Parting />}
          <BlockView block={block} />
        </Row>
      ))}
      unsubscribe={UNSUBSCRIBE_URL}
    />
  );
}
