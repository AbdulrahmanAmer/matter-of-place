import type { CSSProperties } from "react";
import { themeHex } from "../theme.gen.ts";

// The type, the measures and the motion of every email (operator, 2026-10-15: "properly remake all the designs we
// have for the emails ... using the quality of the motion graphic materials"). Studied from the Product Launch film
// (launch/brand-film-kit/reference/product-launch/DIRECTION.md): a serif for what is read, letter-spaced capitals for
// labels, ink that follows the paper, Sandstone only for hairlines and small accents, and motion that eases.
//
// Faces. Every text element names a role class and an inline stack. The class gives the brand stack, inside
// `@media screen` so that Outlook for Windows, which skips media blocks, never sees it: Cormorant Garamond, Jost and
// Epilogue load from the site's own /fonts where a client loads web fonts (Apple Mail, iOS Mail), then the nearest
// system faces. The inline stack is for every client that reads no style block, and starts with a face Office installs,
// because Outlook for Windows reads only the first family and draws Times New Roman when that one is missing.

/** A role: the class that carries the brand stack and the inline stack that stands without it. */
interface Face {
  className: string;
  fontFamily: string;
}

export const serif: Face = {
  className: "mop-serif",
  fontFamily: 'Garamond, Georgia, "Times New Roman", serif',
};

export const sans: Face = {
  className: "mop-sans",
  fontFamily: '"Century Gothic", "Trebuchet MS", Arial, sans-serif',
};

export const small: Face = {
  className: "mop-small",
  fontFamily: '"Segoe UI", Arial, sans-serif',
};

const SERIF_STACK =
  '"Cormorant Garamond","Hoefler Text",Garamond,Baskerville,"Palatino Linotype",Georgia,serif';
const SANS_STACK =
  'Jost,Futura,"Avenir Next","Century Gothic","Segoe UI",Helvetica,Arial,sans-serif';
const SMALL_STACK = 'Epilogue,"Avenir Next","Helvetica Neue","Segoe UI",Helvetica,Arial,sans-serif';

/** The class names an element joins: its face, then the responsive and motion hooks of the style blocks. */
export const cx = (...names: readonly (string | false | undefined)[]): string =>
  names.filter((name) => typeof name === "string" && name !== "").join(" ");

// ---- measures ----------------------------------------------------------------------------------------------------

/** The column, its side margin and the width left for the letter: Outlook takes image widths from these numbers. */
export const COLUMN = 600;
export const MARGIN = 48;
export const MEASURE = COLUMN - 2 * MARGIN;

// ---- the scale -----------------------------------------------------------------------------------------------------

/**
 * The display line of a letter: Cormorant at 40 px (32 on a phone), sentence case, one italic word at most, with
 * lining figures so a number in a title (an invoice's) reads as one; the letter keeps Cormorant's old-style figures.
 */
export const display: CSSProperties = {
  margin: 0,
  fontFamily: serif.fontFamily,
  fontSize: "40px",
  fontWeight: 400,
  fontVariantNumeric: "lining-nums",
  lineHeight: "1.12",
  letterSpacing: "-0.01em",
  color: themeHex.foreground,
};

/** What is read: Cormorant at 19 px with an open leading, in Mineral Grey, the brand's colour for body copy. */
export const reading: CSSProperties = {
  margin: "0 0 18px",
  fontFamily: serif.fontFamily,
  fontSize: "19px",
  fontWeight: 400,
  lineHeight: "1.6",
  color: themeHex.mutedForeground,
};

/** A label: Jost capitals, letter-spaced as the film's labels are (0.28 em), never in italic. */
export const label: CSSProperties = {
  margin: 0,
  fontFamily: sans.fontFamily,
  fontSize: "10px",
  fontWeight: 500,
  lineHeight: "1.5",
  letterSpacing: "0.28em",
  textTransform: "uppercase",
  color: themeHex.mutedForeground,
};

/** The small print of the footer: Epilogue at 11 px. */
export const fine: CSSProperties = {
  margin: 0,
  fontFamily: small.fontFamily,
  fontSize: "11px",
  fontWeight: 400,
  lineHeight: "1.7",
  letterSpacing: "0.02em",
  color: themeHex.accent,
};

/** A text link under a story or a property: a label with a Sandstone hairline beneath it instead of an underline. */
export const textLink: CSSProperties = {
  ...label,
  fontSize: "11px",
  color: themeHex.foreground,
  textDecoration: "none",
  borderBottom: `1px solid ${themeHex.accent}`,
  paddingBottom: "3px",
};

/** A hairline across the measure. */
export const hairline: CSSProperties = {
  height: "1px",
  lineHeight: "1px",
  fontSize: "1px",
  backgroundColor: themeHex.accent,
};

// ---- the head ------------------------------------------------------------------------------------------------------

const FONT_FILES = [
  ["Cormorant Garamond", "normal", "300 700", "cormorant-garamond-latin-wght-normal"],
  ["Cormorant Garamond", "italic", "300 700", "cormorant-garamond-latin-wght-italic"],
  ["Jost", "normal", "100 900", "jost-latin-wght-normal"],
  ["Epilogue", "normal", "100 900", "epilogue-latin-wght-normal"],
] as const;

/**
 * The three style blocks of the head, each its own `<style>` so a client that refuses one keeps the others: the web
 * fonts, the faces and the phone layout, and the motion. Nothing in them is needed to read the email. The font
 * addresses take the origin of `siteUrl` only, so nothing but a scheme and a host can reach the style text.
 */
export function headStyles(siteUrl: string): readonly string[] {
  const { origin } = new URL(siteUrl);
  const fonts = FONT_FILES.map(
    ([family, style, weight, file]) =>
      `@font-face{font-family:"${family}";font-style:${style};font-weight:${weight};font-display:swap;src:url(${origin}/fonts/${file}.woff2) format("woff2")}`,
  ).join("");
  return [`@media screen{${fonts}}`, FACES_AND_PHONE, MOTION];
}

// Cormorant's x-height is about 0.4 of its size; `font-size-adjust` holds a fallback with a taller one (Georgia) to the
// same x-height, so the scale reads the same in Gmail as in Apple Mail.
const FACES_AND_PHONE = [
  "@media screen{",
  `.mop-serif{font-family:${SERIF_STACK}!important;font-size-adjust:0.4}`,
  `.mop-sans{font-family:${SANS_STACK}!important}`,
  `.mop-small{font-family:${SMALL_STACK}!important}`,
  "}",
  "@media screen and (max-width:620px){",
  ".mop-page{padding:0!important}",
  ".mop-column{width:100%!important}",
  ".mop-pad{padding-left:24px!important;padding-right:24px!important}",
  ".mop-display{font-size:32px!important}",
  ".mop-title{font-size:26px!important}",
  ".mop-reading{font-size:18px!important}",
  ".mop-wide{display:none!important}",
  "}",
].join("");

// Motion, for the clients that run it (Apple Mail, iOS Mail) and only for a reader who has not asked for less. Every
// rule only animates toward the state the element already has without it, with `both` so nothing jumps: a client that
// drops this block, or the keyframes, shows the finished page. As in the film, the emblem opens like a door on its
// left hinge, the wordmark settles, the hairline draws from left to right, the label fades, the display line rises
// into its mask with a strong ease out, and the letter follows.
const MOTION = [
  "@media screen and (prefers-reduced-motion:no-preference){",
  "@keyframes mop-door{from{opacity:0;transform:perspective(90px) rotateY(-62deg)}35%{opacity:1}to{opacity:1;transform:none}}",
  "@keyframes mop-settle{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:none}}",
  "@keyframes mop-draw{from{transform:scaleX(0)}to{transform:scaleX(1)}}",
  "@keyframes mop-fade{from{opacity:0}to{opacity:1}}",
  "@keyframes mop-rise{from{transform:translateY(108%)}to{transform:none}}",
  ".mop-door{transform-origin:0 50%;animation:mop-door 1.1s cubic-bezier(.22,.61,.36,1) both}",
  ".mop-mark{animation:mop-settle .9s cubic-bezier(.16,1,.3,1) .2s both}",
  ".mop-rule{transform-origin:0 50%;animation:mop-draw 1.3s cubic-bezier(.65,0,.35,1) .3s both}",
  ".mop-label{animation:mop-fade .6s ease-out .75s both}",
  ".mop-rise{animation:mop-rise .8s cubic-bezier(.16,1,.3,1) .45s both}",
  ".mop-follow{animation:mop-fade .7s ease-out .85s both}",
  "}",
].join("");
