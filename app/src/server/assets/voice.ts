import type { SpecPropertyRow } from "./spec.ts";
import { propertyLink, X_LINK_LENGTH } from "./links.ts";

// Brand voice, checked by code and not trusted to the model (B9 invariant 5). The lists and the limits are exported so
// the prompt of `captions.ts` states exactly the rules this file enforces.

export type CaptionChannel = "instagram" | "x" | "linkedin";

export type CaptionProperty = Pick<
  SpecPropertyRow,
  | "slug"
  | "title"
  | "city"
  | "state"
  | "place"
  | "price"
  | "beds"
  | "baths"
  | "interior_sq_ft"
  | "year_built"
> & { type: string };

export type LintRule =
  | "em_dash"
  | "banned_word"
  | "exclamation"
  | "hashtag"
  | "guarantee"
  | "price_merit"
  | "number_unknown"
  | "link"
  | "length";

export interface LintIssue {
  rule: LintRule;
  message: string;
}

export const BANNED_WORDS = [
  "stunning",
  "dream",
  "dreams",
  "must-see",
  "luxury living",
  "just listed",
  "breathtaking",
  "gorgeous",
  "spectacular",
  "once in a lifetime",
  "unparalleled",
  "world-class",
  "nestled",
  "boasts",
  "priced to sell",
  "act now",
] as const;

export const GUARANTEE_WORDS = [
  "guarantee",
  "guarantees",
  "guaranteed",
  "more leads",
  "new leads",
  "qualified leads",
  "buyers",
  "more sales",
  "will sell",
  "sell fast",
  "quick sale",
] as const;

export const MERIT_WORDS = [
  "exceptional",
  "finest",
  "best",
  "premier",
  "prestigious",
  "worth",
] as const;

/** Instagram and LinkedIn count characters; X counts its link at `X_LINK_LENGTH` (ASSUMED, UNPROVEN). */
export const CAPTION_LIMITS: Record<CaptionChannel, number> = {
  instagram: 2200,
  x: 280,
  linkedin: 3000,
};

const EM_DASH = String.fromCharCode(0x2014);
const URL_PATTERN = /https?:\/\/\S+/g;
const NUMBER_PATTERN = /\d[\d,]*(?:\.\d+)?/g;

/** A word or phrase as a whole word, a space or a hyphen in it matching either. */
function wordPattern(terms: readonly string[]): RegExp {
  const parts = terms.map((term) => term.replace(/[ -]/g, "[ -]"));
  return new RegExp(`\\b(?:${parts.join("|")})\\b`, "i");
}

const BANNED = wordPattern(BANNED_WORDS);
const GUARANTEE = wordPattern(GUARANTEE_WORDS);
const MERIT = wordPattern(MERIT_WORDS);

const withoutLinks = (text: string): string => text.replace(URL_PATTERN, " ");

function linksOf(text: string): string[] {
  return (text.match(URL_PATTERN) ?? []).map((link) => link.replace(/[.,;:!?)]+$/, ""));
}

function numbersOf(text: string): string[] {
  return (withoutLinks(text).match(NUMBER_PATTERN) ?? []).map((token) => token.replaceAll(",", ""));
}

/** The numbers a caption may use: the numeric columns of the row and any number its own text already holds. */
function knownNumbers(property: CaptionProperty): Set<string> {
  const columns = [
    property.price,
    property.beds,
    property.baths,
    property.interior_sq_ft,
    property.year_built,
  ];
  const text = [property.title, property.city, property.state, property.type, property.place ?? ""];
  return new Set([
    ...columns.flatMap((value) => (value === null ? [] : [String(value)])),
    ...text.flatMap(numbersOf),
  ]);
}

function mentionsPrice(sentence: string, property: CaptionProperty): boolean {
  const price = property.price === null ? null : String(property.price);
  return (
    /\$\s?\d/.test(sentence) || (price !== null && sentence.replaceAll(",", "").includes(price))
  );
}

function measure(text: string, channel: CaptionChannel): number {
  return channel === "x"
    ? text.replace(URL_PATTERN, " ".repeat(X_LINK_LENGTH)).length
    : text.length;
}

/** Every rule the caption breaks; an empty list is a pass. */
export function lintCaption(
  text: string,
  property: CaptionProperty,
  channel: CaptionChannel,
): LintIssue[] {
  const issues: LintIssue[] = [];
  const add = (rule: LintRule, message: string) => issues.push({ rule, message });

  if (text.includes(EM_DASH)) add("em_dash", "Use no em dashes.");
  const banned = BANNED.exec(text);
  if (banned !== null) add("banned_word", `Do not use "${banned[0]}".`);
  if (text.includes("!")) add("exclamation", "Use no exclamation marks.");
  if (/(?:^|\s)#\p{L}/u.test(withoutLinks(text))) add("hashtag", "Use no hashtags.");
  const guarantee = GUARANTEE.exec(text);
  if (guarantee !== null) {
    add("guarantee", `Promise no leads, buyers or sales; do not use "${guarantee[0]}".`);
  }
  for (const sentence of text.split(/(?<=[.!?])\s+|\n+/)) {
    const merit = MERIT.exec(sentence);
    if (merit !== null && mentionsPrice(sentence, property)) {
      add("price_merit", `A sentence with a price must not say "${merit[0]}".`);
    }
  }
  const known = knownNumbers(property);
  const unknown = numbersOf(text).filter((token) => !known.has(token));
  if (unknown.length > 0) {
    add("number_unknown", `These numbers are not in the property facts: ${unknown.join(", ")}.`);
  }

  const link = propertyLink(property.slug, channel);
  const links = linksOf(text);
  if (links.some((found) => found !== link) || (channel === "x" && !links.includes(link))) {
    add(
      "link",
      channel === "x"
        ? `Carry exactly this link and no other: ${link}`
        : "Carry no link; the profile holds it.",
    );
  }
  const limit = CAPTION_LIMITS[channel];
  if (measure(text, channel) > limit) {
    add(
      "length",
      `At most ${String(limit)} characters${channel === "x" ? " with the link counted as 23" : ""}.`,
    );
  }
  return issues;
}
