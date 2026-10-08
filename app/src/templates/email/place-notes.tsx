import { Body, Container, Head, Hr, Html, Preview } from "@react-email/components";
import type { CSSProperties } from "react";
import type { SiteContext } from "../../server/email/context.ts";
import { NewsletterBlock, type NewsletterBlockProps } from "../social/NewsletterBlock.tsx";
import { themeHex } from "../theme.gen.ts";
import { Footer } from "./blocks/footer.tsx";
import { Intro } from "./blocks/intro.tsx";
import { Masthead } from "./blocks/masthead.tsx";
import { Story } from "./blocks/story.tsx";
import { fonts } from "./layout.tsx";

// The Place Notes issue: masthead, the blocks in reading order, the footer. Colours come from `theme.gen.ts` (G-007).
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

const page: CSSProperties = {
  margin: 0,
  padding: "32px 12px",
  backgroundColor: themeHex.secondary,
  fontFamily: fonts.body,
  color: themeHex.foreground,
};

const column: CSSProperties = {
  maxWidth: "600px",
  margin: "0 auto",
  padding: "40px 32px",
  backgroundColor: themeHex.background,
};

const rule: CSSProperties = {
  margin: "28px 0",
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
    <Html lang="en">
      <Head>
        <title>{title}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light" />
      </Head>
      <Body style={page}>
        <Container style={column}>
          {preheader === "" ? null : <Preview>{preheader}</Preview>}
          <Masthead number={number} />
          {blocks.map((block) => (
            <div key={block.id}>
              <Hr style={rule} />
              <BlockView block={block} />
            </div>
          ))}
          <Hr style={rule} />
          <Footer site={site} />
        </Container>
      </Body>
    </Html>
  );
}
