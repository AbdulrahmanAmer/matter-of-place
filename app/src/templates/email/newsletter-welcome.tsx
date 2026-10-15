import { variablesByKey } from "../../domain/email.ts";
import { themeHex } from "../theme.gen.ts";
import { Blocks } from "./blocks.tsx";
import { Unsubscribe } from "./blocks/footer.tsx";
import { Rule } from "./blocks/rule.tsx";
import { Layout, type EmailDefinition, type EmailProps, type TextParts } from "./layout.tsx";
import { cx, display, label, reading, sans, serif, textLink } from "./style.ts";

// The welcome (operator, 2026-10-15: "make sure that we have a slot in place for the newsletter stuff for when people
// sign up for it"). Sent once, right after a person confirms: the row thanks them and says what they will receive and
// how often (`what_you_receive`, which the resolver words for a Place Notes reader or an interest signup), and this
// file draws the slot under it, the lead piece of the latest Place Notes issue sent, or a quiet line while none has
// gone out. Copy lives in the row; the slot's few fixed words are part of its design, as the masthead's are.

export const definition: EmailDefinition = {
  key: "newsletter_welcome",
  class: "transactional",
  subject: "Welcome to Matter of Place",
  preheader: "What we will send you, and how often.",
  variables: variablesByKey.newsletter_welcome,
  blocks: [
    { type: "heading", text: "Thank you for confirming." },
    {
      type: "paragraph",
      text: "Matter of Place publishes existing homes in California, New York and Florida, one at a time, each chosen for what it is rather than what it costs.",
    },
    { type: "paragraph", text: "{{what_you_receive}}" },
    {
      type: "paragraph",
      text: "We write only when there is something to read. If you would rather not hear from us, reply to this email at any time and we will take you off the list.",
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

export function Email({ title, preheader, blocks, site, variables }: EmailProps) {
  const piece = latestPiece(variables);
  const href = unsubscribeHref(site.contact.email);
  return (
    <Layout
      title={title}
      preheader={preheader}
      site={site}
      label="Welcome"
      afterFooter={href === null ? null : <Unsubscribe href={href} />}
    >
      <Blocks blocks={blocks} />
      <div className="mop-follow">
        <Rule padding="20px 0 34px" />
        {piece === null ? (
          <>
            <p className={sans.className} style={{ ...label, margin: "0 0 12px" }}>
              Place Notes
            </p>
            <p
              className={cx(serif.className, "mop-reading")}
              style={{ ...reading, margin: 0, fontStyle: "italic", color: themeHex.foreground }}
            >
              {QUIET_LINE}
            </p>
          </>
        ) : (
          <>
            <p className={sans.className} style={{ ...label, margin: "0 0 14px" }}>
              {`From Place Notes No. ${piece.number}`}
            </p>
            <h2
              className={cx(serif.className, "mop-title")}
              style={{ ...display, fontSize: "28px", lineHeight: "1.18", margin: "0 0 10px" }}
            >
              {piece.title}
            </h2>
            <p
              className={cx(serif.className, "mop-reading")}
              style={{ ...reading, margin: "0 0 20px" }}
            >
              {piece.line}
            </p>
            <a href={piece.url} className={sans.className} style={textLink}>
              Read it
            </a>
          </>
        )}
      </div>
    </Layout>
  );
}
