import type { CSSProperties } from "react";
import { themeHex } from "../theme.gen.ts";

// The one style source of every email (operator, 2026-10-15: "use all of the designs directions ... based on the type
// of the email"). Three houses share it: Threshold for the moments (something happened), Afternoon for correspondence
// (a letter from us), and Threshold's light variant for the mail the team reads several times a day. They are one house
// because they share these faces, this scale, these five colours and the same colophon; they differ in how the page is
// cut (`house/*.tsx`).
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

/** The class names an element joins: its face, then the responsive, dark and motion hooks of the style blocks. */
export const cx = (...names: readonly (string | false | undefined)[]): string =>
  names.filter((name) => typeof name === "string" && name !== "").join(" ");

// ---- colour -------------------------------------------------------------------------------------------------------

/**
 * The five colours of `theme.gen.ts` by their brand names. Warm Grey is not among them (the site's tokens hold five), so
 * an email never types it; it lives only in the pictures.
 */
export const ink = {
  obsidian: themeHex.foreground,
  ivory: themeHex.background,
  bone: themeHex.secondary,
  mineral: themeHex.mutedForeground,
  sandstone: themeHex.accent,
} as const;

/** The paper a part is set on, and what reads on it. */
export type Tone = "dark" | "light";

/** The papers a band is set on: Threshold's two values, Bone for the colophon, Sandstone for a market. */
export const PAPER = {
  dark: ink.obsidian,
  light: ink.ivory,
  bone: ink.bone,
  sand: ink.sandstone,
} as const;

export type Paper = keyof typeof PAPER;

/** The ink of each tone: the text, the quieter text, and the hairlines. */
export const on = {
  light: { text: ink.obsidian, quiet: ink.mineral, rule: ink.sandstone },
  dark: { text: ink.bone, quiet: ink.sandstone, rule: ink.mineral },
} as const;

// ---- measures -----------------------------------------------------------------------------------------------------

/** The column, its side margin and the width left for words: Outlook takes image widths from these numbers. */
export const COLUMN = 600;
export const GUTTER = 40;
export const MEASURE = COLUMN - 2 * GUTTER;
/** The side margin as a padding length, for the rows of every house. */
export const SIDE = `${String(GUTTER)}px`;
/** Afternoon's centred schedules and amounts. */
export const NARROW = 460;

// ---- the scale ------------------------------------------------------------------------------------------------------

/** Cormorant, light, with lining figures so a number in a title (an amount, an address) reads as one. */
const display: CSSProperties = {
  margin: 0,
  fontFamily: serif.fontFamily,
  fontWeight: 300,
  fontVariantNumeric: "lining-nums",
  letterSpacing: "-0.01em",
};

/** Threshold's opening lines, either side of the door: 46 px (34 on a phone, `.mop-t-door`). */
export const doorLine: CSSProperties = { ...display, fontSize: "46px", lineHeight: "50px" };

/** Threshold's typeset stack of where a home stands: 60 px (44 on a phone, `.mop-t-stack`). */
export const stackLine: CSSProperties = { ...display, fontSize: "60px", lineHeight: "62px" };

/** The title of a later shot, or of a market: 48 px (36 on a phone, `.mop-t-shot`). */
export const shotTitle: CSSProperties = { ...display, fontSize: "48px", lineHeight: "52px" };

/** Afternoon's placard title: 44 px (36 on a phone, `.mop-t-title`). */
export const placardTitle: CSSProperties = { ...display, fontSize: "44px", lineHeight: "48px" };

/** Afternoon's one sentence set large on the axis: 29 px (24 on a phone, `.mop-t-state`). */
export const statement: CSSProperties = { ...display, fontSize: "29px", lineHeight: "39px" };

/** The light house's title: 34 px (28 on a phone, `.mop-t-light`). */
export const lightTitle: CSSProperties = { ...display, fontSize: "34px", lineHeight: "40px" };

/** An amount set as a figure: 46 px (38 on a phone, `.mop-t-total`). */
export const figure: CSSProperties = {
  ...display,
  fontSize: "46px",
  lineHeight: "48px",
  fontVariantNumeric: "lining-nums tabular-nums",
  whiteSpace: "nowrap",
};

/** What is read: Cormorant at 20 px with an open leading (18 on a phone, `.mop-t-read`). */
export const reading: CSSProperties = {
  margin: "0 0 18px",
  fontFamily: serif.fontFamily,
  fontSize: "20px",
  fontWeight: 400,
  lineHeight: "32px",
};

/** A value in a record: Cormorant at 20 px, lining figures. */
export const value: CSSProperties = {
  margin: 0,
  fontFamily: serif.fontFamily,
  fontSize: "20px",
  fontWeight: 400,
  lineHeight: "26px",
  fontVariantNumeric: "lining-nums",
};

/** A label: Jost capitals, letter-spaced as the film's labels are, never in italic. */
export const label: CSSProperties = {
  margin: 0,
  fontFamily: sans.fontFamily,
  fontSize: "10px",
  fontWeight: 500,
  lineHeight: "15px",
  letterSpacing: "0.3em",
  textTransform: "uppercase",
};

/** The way to a story or a home: a label with a hairline under it instead of an underline, never a pill. */
export const textLink = (color: string, rule: string): CSSProperties => ({
  ...label,
  fontSize: "11px",
  color,
  textDecoration: "none",
  borderBottom: `1px solid ${rule}`,
  paddingBottom: "4px",
});

/** The colophon: Epilogue, the brand's face for footers. */
export const fine: CSSProperties = {
  margin: 0,
  fontFamily: small.fontFamily,
  fontSize: "12px",
  fontWeight: 300,
  lineHeight: "20px",
};

/** A hairline drawn as a filled cell, which every client keeps. */
export const hairline = (color: string, height = 1): CSSProperties => ({
  height: `${String(height)}px`,
  lineHeight: `${String(height)}px`,
  fontSize: "1px",
  backgroundColor: color,
});

// ---- the head -------------------------------------------------------------------------------------------------------

const FONT_FILES = [
  ["Cormorant Garamond", "normal", "300 700", "cormorant-garamond-latin-wght-normal"],
  ["Cormorant Garamond", "italic", "300 700", "cormorant-garamond-latin-wght-italic"],
  ["Jost", "normal", "100 900", "jost-latin-wght-normal"],
  ["Epilogue", "normal", "100 900", "epilogue-latin-wght-normal"],
] as const;

/**
 * The four style blocks of the head, each its own `<style>` so a client that refuses one keeps the others: the web
 * fonts, the faces and the phone layout, the dark papers, and the motion. Nothing in them is needed to read the email.
 * The font addresses take the origin of `siteUrl` only, so nothing but a scheme and a host can reach the style text.
 */
export function headStyles(siteUrl: string): readonly string[] {
  const { origin } = new URL(siteUrl);
  const fonts = FONT_FILES.map(
    ([family, style, weight, file]) =>
      `@font-face{font-family:"${family}";font-style:${style};font-weight:${weight};font-display:swap;src:url(${origin}/fonts/${file}.woff2) format("woff2")}`,
  ).join("");
  return [`@media screen{${fonts}}`, FACES_AND_PHONE, DARK, MOTION];
}

// Cormorant's x-height is about 0.4 of its size; `font-size-adjust` holds a fallback with a taller one (Georgia) to the
// same x-height, so the scale reads the same in Gmail as in Apple Mail. On a phone the column takes the screen (a table
// of fixed width ignores `max-width`, P-3483), the side margin narrows, the large lines step down, side-by-side cells
// stack, and a picture takes the width of the screen.
const FACES_AND_PHONE = [
  "body{margin:0!important;padding:0!important;-webkit-text-size-adjust:100%}",
  "@media screen{",
  `.mop-serif{font-family:${SERIF_STACK}!important;font-size-adjust:0.4}`,
  `.mop-sans{font-family:${SANS_STACK}!important}`,
  `.mop-small{font-family:${SMALL_STACK}!important}`,
  "}",
  "@media screen and (max-width:620px){",
  ".mop-col{width:100%!important}",
  ".mop-px{padding-left:24px!important;padding-right:24px!important}",
  ".mop-img{width:100%!important;height:auto!important}",
  ".mop-cell{display:block!important;width:100%!important;padding:0 0 18px!important}",
  ".mop-narrow{width:100%!important}",
  ".mop-t-door{font-size:34px!important;line-height:38px!important}",
  ".mop-t-stack{font-size:44px!important;line-height:46px!important}",
  ".mop-t-shot{font-size:36px!important;line-height:40px!important}",
  ".mop-t-title{font-size:36px!important;line-height:40px!important}",
  ".mop-t-state{font-size:24px!important;line-height:33px!important}",
  ".mop-t-light{font-size:28px!important;line-height:34px!important}",
  ".mop-t-total{font-size:38px!important;line-height:40px!important}",
  ".mop-t-read{font-size:18px!important;line-height:29px!important}",
  ".mop-wide{display:none!important}",
  "}",
].join("");

// Apple Mail and iOS Mail in dark mode: night falls, as it does in the film. The light papers turn Obsidian, their ink
// turns Bone, a picture drawn for a light page gives way to its night version, and a button keeps its contrast. A
// client that ignores the query keeps the light page, which is complete. One declaration to a rule, so a colour is
// always the first thing after a brace.
const DARK = [
  "@media (prefers-color-scheme:dark){",
  `.mop-paper{background-color:${ink.obsidian}!important}`,
  `.mop-ink{color:${ink.bone}!important}`,
  `.mop-ink2{color:${ink.sandstone}!important}`,
  `.mop-hair{background-color:${ink.mineral}!important}`,
  `.mop-dash{background-color:${ink.bone}!important}`,
  `.mop-fut{color:${ink.mineral}!important}`,
  `.mop-ruled{border-color:${ink.mineral}!important}`,
  `.mop-btn{background-color:${ink.bone}!important}`,
  `.mop-btn a{color:${ink.obsidian}!important}`,
  ".mop-lm{display:none!important}",
  ".mop-dm{display:block!important}",
  ".mop-dm{max-height:none!important}",
  "}",
].join("");

// Motion, for the clients that run it (Apple Mail, iOS Mail) and only for a reader who has not asked for less. Every
// rule only animates toward the state the element already has without it, with `both` so nothing jumps: a client that
// drops this block, or the keyframes, shows the finished page. As in the film, a line rises into a mask the size of the
// line, a label opens its tracking, a hairline draws from the left; never a bounce. The delays follow the door: its GIF
// holds the logo, then opens, and the words around it arrive as it does.
const MOTION = [
  "@media screen and (prefers-reduced-motion:no-preference){",
  "@keyframes mop-rise{from{transform:translateY(112%)}to{transform:none}}",
  "@keyframes mop-track{from{opacity:0;letter-spacing:0}to{opacity:1}}",
  "@keyframes mop-wipe{from{transform:scaleX(0)}to{transform:scaleX(1)}}",
  "@keyframes mop-fade{from{opacity:0}to{opacity:1}}",
  ".mop-m{display:inline-block;overflow:hidden;vertical-align:top;padding:0 .1em .18em 0;margin:0 -.1em -.18em 0}",
  ".mop-r{display:inline-block;animation:mop-rise .85s cubic-bezier(.16,1,.3,1) both}",
  ".mop-k{animation:mop-track 1.3s cubic-bezier(.22,1,.36,1) both}",
  ".mop-w{transform-origin:0 50%;animation:mop-wipe 1s cubic-bezier(.65,0,.35,1) both}",
  ".mop-f{animation:mop-fade .7s ease-out both}",
  ".mop-d0{animation-delay:.15s}.mop-d1{animation-delay:.3s}.mop-d2{animation-delay:.45s}",
  ".mop-d3{animation-delay:1.5s}.mop-d4{animation-delay:3.1s}.mop-d5{animation-delay:3.4s}.mop-d6{animation-delay:3.9s}",
  "}",
].join("");
