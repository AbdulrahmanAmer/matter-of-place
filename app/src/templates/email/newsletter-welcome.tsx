import { variablesByKey } from "../../domain/email.ts";
import { ART, type Art } from "./art.ts";
import { Band, PAPER, Row, type Paper } from "./blocks/band.tsx";
import { Picture } from "./blocks/picture.tsx";
import { Threshold } from "./house/threshold.tsx";
import { variable, type EmailDefinition, type EmailProps, type TextParts } from "./layout.tsx";
import {
  cx,
  GUTTER,
  ink,
  label,
  MEASURE,
  reading,
  sans,
  serif,
  shotTitle,
  textLink,
} from "./style.ts";

// The welcome (operator, 2026-10-15: "make sure that we have a slot in place for the newsletter stuff for when people
// sign up for it"), a moment in Threshold: the door opens on "is open.", the row says what the reader will receive and
// how often (`what_you_receive`, worded by the resolver for a Place Notes reader or an interest signup), and this file
// draws two shots after it: the lead piece of the latest Place Notes issue sent, with its picture or, when it has none,
// a still of the film's own house (orchestrator ruling, 2026-10-15), or a quiet line while no issue has gone out; then
// the three markets, as the film cuts them. Copy lives in the row; the shots' few fixed words are part of their design.

export const definition: EmailDefinition = {
  key: "newsletter_welcome",
  class: "transactional",
  subject: "Welcome to Matter of Place",
  preheader: "What we will send you, and how often.",
  variables: variablesByKey.newsletter_welcome,
  blocks: [
    { type: "heading", text: "The door" },
    { type: "heading", text: "is open." },
    {
      type: "paragraph",
      text: "Matter of Place publishes existing homes in California, New York and Florida, one at a time, each chosen for what it is rather than what it costs.",
    },
    { type: "paragraph", text: "{{what_you_receive}}" },
    { type: "heading", text: "We write only when there is something to read.", level: 2 },
    {
      type: "paragraph",
      text: "If you would rather not hear from us, reply to this email at any time and we will take you off the list.",
    },
  ],
};

/**
 * The four strings of the slot as the variables give them; any one missing or empty means no issue to show. A mail
 * client must never be given a `javascript:` or plain `http:` address, whoever typed the variable (a preview takes
 * typed values), so an address that is not https is no piece either.
 */
function latestPiece(variables: EmailProps["variables"]) {
  const text = (name: string): string => {
    const value = variables[name];
    return typeof value === "string" ? value : "";
  };
  const piece = {
    number: text("latest_number"),
    title: text("latest_title"),
    line: text("latest_line"),
    url: text("latest_url"),
  };
  const https = URL.canParse(piece.url) && new URL(piece.url).protocol === "https:";
  return https && Object.values(piece).every((value) => value !== "") ? piece : null;
}

/** The piece's own picture when it is an https address, else nothing (the film's house stands in). */
const pieceImage = (variables: EmailProps["variables"]): string | null => {
  const image = variable(variables, "latest_image");
  return URL.canParse(image) && new URL(image).protocol === "https:" ? image : null;
};

const QUIET_LINE = "The first issue of Place Notes is being prepared.";

/** The slot's lines in the plain-text part, after the legal lines: the piece and its address, or the quiet line. */
export function textParts(variables: EmailProps["variables"]): TextParts {
  const piece = latestPiece(variables);
  return {
    lead: [],
    trail:
      piece === null
        ? [QUIET_LINE]
        : [`From Place Notes No. ${piece.number}`, piece.title, piece.line, piece.url],
  };
}

/** A one-to-one email is not a broadcast, so Resend fills no unsubscribe page: the link writes to the house. */
const unsubscribeHref = (address: string | null): string | null =>
  address === null ? null : `mailto:${address}?subject=Unsubscribe`;

const side = `${String(GUTTER)}px`;

/** An Open Graph rendition is 1200 by 630; the film's still is 3 by 2. */
const PIECE: Pick<Art, "width" | "height"> = { width: MEASURE, height: 273 };

/** The latest piece as a page of its own, on Warm Ivory. */
function Latest({ variables, siteUrl }: { variables: EmailProps["variables"]; siteUrl: string }) {
  const piece = latestPiece(variables);
  const image = piece === null ? null : pieceImage(variables);
  const quiet = { ...label, color: ink.mineral } as const;
  return (
    <Band paper="light">
      <Row padding={`72px ${side} 0`}>
        <p className={cx(sans.className, "mop-ink2")} style={quiet}>
          {piece === null ? "Place Notes" : `From Place Notes No. ${piece.number}`}
        </p>
      </Row>
      <Row padding={`22px ${side} 0`}>
        {image === null ? (
          <Picture
            src={`${siteUrl}${ART.house.path}`}
            art={ART.house}
            alt="A house from the Matter of Place film, in model."
            paper={ink.sandstone}
            ink={ink.mineral}
            bleed
          />
        ) : (
          <Picture
            src={image}
            art={PIECE}
            alt={piece?.title ?? ""}
            paper={ink.sandstone}
            ink={ink.mineral}
            bleed
          />
        )}
      </Row>
      {piece === null ? (
        <Row padding={`26px ${side} 72px`}>
          <p
            className={cx(serif.className, "mop-t-read", "mop-ink")}
            style={{ ...reading, margin: 0, fontStyle: "italic", color: ink.obsidian }}
          >
            {QUIET_LINE}
          </p>
        </Row>
      ) : (
        <Row padding={`28px ${side} 72px`}>
          <p
            className={cx(serif.className, "mop-t-shot", "mop-ink")}
            style={{ ...shotTitle, fontSize: "36px", lineHeight: "40px", color: ink.obsidian }}
          >
            {piece.title}
          </p>
          <p
            className={cx(serif.className, "mop-t-read", "mop-ink2")}
            style={{ ...reading, margin: "12px 0 22px", color: ink.mineral }}
          >
            {piece.line}
          </p>
          <a
            href={piece.url}
            className={cx(sans.className, "mop-ink")}
            style={textLink(ink.obsidian, ink.sandstone)}
          >
            Read it
          </a>
        </Row>
      )}
    </Band>
  );
}

const MARKETS: readonly { name: string; art: Art; paper: Paper; alt: string }[] = [
  {
    name: "California",
    art: ART.california,
    paper: "sand",
    alt: "California: a low house in raking sun, with palms.",
  },
  {
    name: "New York",
    art: ART.newYork,
    paper: "dark",
    alt: "New York: brownstones at night, lit windows.",
  },
  {
    name: "Florida",
    art: ART.florida,
    paper: "light",
    alt: "Florida: a glass pavilion under a high white sun.",
  },
];

/** The three markets as the film cuts them: California on sand, New York at night, Florida in white light. */
function Markets({ siteUrl }: { siteUrl: string }) {
  return (
    <>
      {MARKETS.map((market, index) => {
        const dark = market.paper === "dark";
        return (
          <Band key={market.name} paper={market.paper}>
            {index === 0 ? (
              <Row padding={`64px ${side} 0`}>
                <p className={sans.className} style={{ ...label, color: ink.mineral }}>
                  Three markets only
                </p>
              </Row>
            ) : null}
            <Row padding={index === 0 ? "26px 0 0" : "0"} align="center" bleed>
              <Picture
                src={`${siteUrl}${market.art.path}`}
                art={market.art}
                alt={market.alt}
                paper={PAPER[market.paper]}
                ink={dark ? ink.sandstone : ink.mineral}
                bleed
              />
            </Row>
            <Row padding={`22px ${side} 56px`}>
              <p
                className={cx(sans.className, !dark && market.paper === "light" && "mop-ink2")}
                style={{ ...label, margin: "0 0 6px", color: dark ? ink.sandstone : ink.mineral }}
              >
                {`0${String(index + 1)} / 03`}
              </p>
              <p
                className={cx(serif.className, "mop-t-shot", market.paper === "light" && "mop-ink")}
                style={{ ...shotTitle, color: dark ? ink.bone : ink.obsidian }}
              >
                {market.name}
              </p>
            </Row>
          </Band>
        );
      })}
    </>
  );
}

export function Email(props: EmailProps) {
  const href = unsubscribeHref(props.site.contact.email);
  return (
    <Threshold
      {...props}
      label="Confirmed"
      place={variable(props.variables, "market_names")}
      after={
        <>
          <Latest variables={props.variables} siteUrl={props.site.siteUrl} />
          <Markets siteUrl={props.site.siteUrl} />
        </>
      }
      note="You confirmed at matterofplace.com."
      unsubscribe={href ?? undefined}
    />
  );
}
