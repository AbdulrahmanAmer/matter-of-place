import { siteConfig } from "../config/site";
import type { Market } from "../domain/market";
import type { Property } from "../domain/property";
import type { Story } from "../domain/story";
import { formatNumber, pluralize } from "./format";

/**
 * Meta descriptions, written from data by pure functions (no model, S20). Each is 70 to 155 characters:
 * whole sentences are added while they fit, a first sentence that is too long is cut at a word, and a
 * description that is too short is completed with the platform line.
 */
const MIN = 70;
const MAX = 155;
const PLATFORM =
  "Matter of Place is an editorial real-estate media platform for residential property in California, New York and Florida.";

function cutAtWord(text: string): string {
  if (text.length <= MAX) return text;
  const head = text.slice(0, MAX - 1);
  const end = /\s/.test(text.charAt(MAX - 1)) ? head.length : head.lastIndexOf(" ");
  return `${(end > 0 ? head.slice(0, end) : head).replace(/[\s,;:]+$/, "")}.`;
}

function compose(sentences: string[]): string {
  let text = "";
  for (const sentence of sentences) {
    const next = text === "" ? sentence : `${text} ${sentence}`;
    if (next.length > MAX) break;
    text = next;
  }
  if (text === "") return cutAtWord(sentences[0] ?? "");
  return text.length < MIN ? cutAtWord(`${text} ${PLATFORM}`) : text;
}

export function propertyDescription(
  property: Pick<Property, "city" | "state" | "beds" | "interiorSqFt" | "style">,
): string {
  const { city, state, beds, interiorSqFt, style } = property;
  return compose([
    `${city}, ${state}: ${String(beds)} ${pluralize(beds, "bedroom")}, ${formatNumber(interiorSqFt)} sq ft, ${style.toLowerCase()} architecture and a sense of place.`,
  ]);
}

export function storyDescription(story: Pick<Story, "deck">): string {
  return compose([story.deck]);
}

const firstSentence = (text: string) => `${text.split(".")[0] ?? text}.`;
type Named = { name: string }[];
const names = (items: Named) => items.map((item) => item.name).join(", ");

export function marketDescription(market: Pick<Market, "intro"> & { regions: Named }): string {
  return compose([
    firstSentence(market.intro),
    `Property stories across ${names(market.regions)}.`,
  ]);
}

export function marketGuideDescription(market: Pick<Market, "name"> & { regions: Named }): string {
  return compose([
    `Neighborhoods, what clients ask for, and how we work in ${market.name}: ${names(market.regions)}.`,
  ]);
}

export function regionDescription(region: Market["regions"][number]): string {
  return compose([region.intro, `Properties in ${region.places.join(", ")}.`]);
}

export function archiveDescription(
  kind: "city" | "architect" | "style",
  label: string,
  count: number,
): string {
  const published = `${String(count)} published ${pluralize(count, "property", "properties")}`;
  const where = {
    city: `in ${label}`,
    architect: `by ${label}`,
    style: `in the ${label} style`,
  }[kind];
  return compose([`${published} ${where}, presented with their place and architecture.`]);
}

const pageDescriptions = {
  index: siteConfig.description,
  properties:
    "A quiet selection of residences across California, Florida and New York, searchable by place, type and architecture.",
  "stories.index":
    "Architecture, interiors and places across California, New York and Florida, from the Matter of Place editorial desks.",
  exposure:
    "How a property is presented and distributed: The Feature, The Reach, The Campaign and Five Features, all after editorial review.",
  submit:
    "Submit an existing residential property in California, New York or Florida for editorial review.",
  about:
    "An independent real-estate media platform for exceptional residential property in California, New York and Florida. A product of Omnikom.",
  contact:
    "Write to Matter of Place about a property, a market, or presenting a residence you own or represent.",
  faq: "Short answers about Matter of Place: what we feature, what it costs and who receives inquiries.",
  "editorial-standard":
    "What Matter of Place looks for in a property: architecture, design, originality, materiality, setting, history and craft. Price is not the measure.",
  legal:
    "Illustrative-content notice, representation, editorial independence, privacy and terms for Matter of Place.",
  "markets.index": "California, New York and Florida. Three markets, one editorial point of view.",
  privacy:
    "How Matter of Place collects, uses and keeps personal information, and how to ask for a copy or for deletion.",
  terms:
    "The terms for using the Matter of Place site and for submitting a property for editorial review.",
  accessibility:
    "How Matter of Place works to keep the site usable by everyone, and how to tell us about a barrier.",
  "privacy-request":
    "Ask for a copy of the personal information Matter of Place holds about you, or ask for it to be deleted.",
  cookies:
    "The cookies and similar storage Matter of Place uses on this site, and how to change your choice.",
  "privacy-choices":
    "Change your analytics choice for Matter of Place at any time, and read what each choice means.",
  "place-notes":
    "Place Notes is the Matter of Place newsletter: short editions on architecture and place, for the markets you choose to follow.",
} as const;

export type PageDescriptionKey = keyof typeof pageDescriptions;

export const pageDescriptionKeys = Object.keys(pageDescriptions).filter(
  (key): key is PageDescriptionKey => key in pageDescriptions,
);

export const pageDescription = (key: PageDescriptionKey): string => pageDescriptions[key];
