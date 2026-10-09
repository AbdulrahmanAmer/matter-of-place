import { storyCategories, type StoryDetail, type StoryPatch } from "../../domain/admin-stories";
import { marketSlugSchema, type MarketSlug } from "../../domain/market";

// What screen 14's form holds: the fields `PATCH stories/:id` takes, as text a person edits.

export const marketNames: Record<MarketSlug, string> = {
  california: "California",
  florida: "Florida",
  "new-york": "New York",
};

export interface StoryValues {
  slug: string;
  title: string;
  deck: string;
  category: string;
  market_slug: string;
  /** One paragraph per blank line. */
  body: string;
  /** Property slugs, separated by spaces, commas or new lines. */
  properties: string;
}

const emptyValues: StoryValues = {
  slug: "",
  title: "",
  deck: "",
  category: "",
  market_slug: "",
  body: "",
  properties: "",
};

export function valuesOf(story: StoryDetail | null): StoryValues {
  if (story === null) return emptyValues;
  return {
    slug: story.slug,
    title: story.title,
    deck: story.deck,
    category: story.category,
    market_slug: story.market_slug,
    body: story.body.join("\n\n"),
    properties: story.properties.join(" "),
  };
}

const PARAGRAPH_BREAK = /\n\s*\n/;
const SLUG_SEPARATOR = /[\s,]+/;

const paragraphsOf = (text: string) =>
  text
    .split(PARAGRAPH_BREAK)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== "");

const slugsOf = (text: string) => text.split(SLUG_SEPARATOR).filter((slug) => slug !== "");

/** The fields of `values` that differ from `saved`, in the shape the API takes. */
export function patchOf(saved: StoryValues, values: StoryValues): StoryPatch {
  const patch: StoryPatch = {};
  if (values.slug !== saved.slug) patch.slug = values.slug.trim();
  if (values.title !== saved.title) patch.title = values.title.trim();
  if (values.deck !== saved.deck) patch.deck = values.deck.trim();
  const category = storyCategories.find((name) => name === values.category);
  if (values.category !== saved.category && category !== undefined) patch.category = category;
  const market = marketSlugSchema.safeParse(values.market_slug);
  if (values.market_slug !== saved.market_slug && market.success) patch.market_slug = market.data;
  if (values.body !== saved.body) patch.body = paragraphsOf(values.body);
  if (values.properties !== saved.properties) patch.properties = slugsOf(values.properties);
  return patch;
}

/** A new story needs these five before Save is offered (`save_story` refuses a draft without them). */
export const isComplete = (values: StoryValues) =>
  [values.slug, values.title, values.deck, values.category, values.market_slug].every(
    (field) => field.trim() !== "",
  );
