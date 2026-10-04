import { z } from "zod";
import type { SlideSpec } from "../../templates/social/slides.ts";
import { NonRetryableError } from "../jobs/types.ts";
import type { Db } from "../lib/db.ts";
import { AppError } from "../lib/errors.ts";
import { propertyLink, X_LINK_LENGTH } from "./links.ts";
import {
  BANNED_WORDS,
  CAPTION_LIMITS,
  GUARANTEE_WORDS,
  MERIT_WORDS,
  lintCaption,
  type CaptionChannel,
  type CaptionProperty,
} from "./voice.ts";

// The prompt and the lint loop of `write_captions` (B9 invariant 5, ASSUMED H34). The model is reached only through
// the `complete` function the caller passes, so this file calls no network and reads no secret.

const CHANNELS = ["instagram", "x", "linkedin"] as const satisfies readonly CaptionChannel[];

export interface Completion {
  text: string;
  usage: { input_tokens: number; output_tokens: number };
}

export interface CaptionDeps {
  complete(prompt: string, signal: AbortSignal): Promise<Completion>;
  /** `settings.caption_model`. */
  model: string;
  signal: AbortSignal;
}

/** What the caption needs of the carousel's render spec: the photographs' alt texts and the planned slides. */
export interface CaptionSpec {
  images: readonly { alt: string }[];
  slides: readonly SlideSpec[];
}

const answerSchema = z.object({
  instagram: z.string(),
  x: z.string(),
  linkedin: z.string(),
  alt_text: z.string(),
  slide_alts: z.array(z.string()),
});

type Captions = z.infer<typeof answerSchema>;

export interface WrittenCaptions {
  captions: Captions;
  /** `failed` when a variant still broke a rule on the second answer; the asset then cannot be approved. */
  caption_lint: "passed" | "failed";
  usage: { model: string; input_tokens: number; output_tokens: number };
}

/** The model the caption runner passes to the CLI; the row is seeded by B9's migration and no screen edits it. */
export async function loadCaptionModel(db: Db): Promise<string> {
  const { data, error } = await db.from("settings").select("value").eq("key", "caption_model");
  if (error !== null) {
    throw new AppError("unavailable", undefined, "The settings read did not answer.");
  }
  const model = z.string().min(1).safeParse(data[0]?.value);
  if (!model.success) throw new NonRetryableError("caption_model_missing");
  return model.data;
}

function facts(property: CaptionProperty): string[] {
  const { price, beds, baths, interior_sq_ft: sqft, year_built: built } = property;
  return [
    `Title: ${property.title}`,
    `Place: ${property.city}, ${property.state}`,
    `Type: ${property.type}`,
    ...(price === null ? [] : [`Price: $${price.toLocaleString("en-US")}`]),
    ...(beds === null ? [] : [`Bedrooms: ${String(beds)}`]),
    ...(baths === null ? [] : [`Bathrooms: ${String(baths)}`]),
    ...(sqft === null ? [] : [`Interior: ${sqft.toLocaleString("en-US")} square feet`]),
    ...(built === null ? [] : [`Year built: ${String(built)}`]),
    ...(property.place === null || property.place === "" ? [] : [`The setting: ${property.place}`]),
  ];
}

function buildPrompt(property: CaptionProperty, spec: CaptionSpec): string {
  const slides = spec.slides.map(
    (slide, at) => `${String(at + 1)}. ${slide.kind}: ${spec.images[slide.image]?.alt ?? ""}`,
  );
  return [
    "You write the social captions of Matter of Place, a selective publication of existing homes in California, New York and Florida.",
    "",
    "The property",
    ...facts(property).map((line) => `- ${line}`),
    "",
    "The slides of its carousel, each with the photograph it shows",
    ...slides,
    "",
    "Voice rules, every one is checked by code",
    "- Calm, brief and specific. No hyperbole.",
    "- Never write the em dash character; use a full stop or a comma where you would. No exclamation marks, no hashtags.",
    `- Never use: ${BANNED_WORDS.join(", ")}.`,
    `- Promise no leads, buyers or sales. Never use: ${GUARANTEE_WORDS.join(", ")}.`,
    `- A sentence that holds a price must not hold: ${MERIT_WORDS.join(", ")}.`,
    "- Use only numbers that appear in the property above, written as given.",
    "",
    "The three captions",
    `- instagram: at most ${String(CAPTION_LIMITS.instagram)} characters, no link.`,
    `- x: one or two plain sentences, at most ${String(CAPTION_LIMITS.x)} characters with a link counted as ${String(X_LINK_LENGTH)}, ending with this link exactly: ${propertyLink(property.slug, "x")}`,
    `- linkedin: one longer paragraph for agents and brokerages: what the property is, why it was selected, what an agent can do with the dossier. At most ${String(CAPTION_LIMITS.linkedin)} characters, ending with this link exactly: ${propertyLink(property.slug, "linkedin")}`,
    "",
    `Answer with one JSON object and nothing else: {"instagram": "", "x": "", "linkedin": "", "alt_text": "", "slide_alts": []}. alt_text is one plain sentence describing the first photograph. slide_alts holds ${String(spec.slides.length)} plain sentences, one per slide in order, each describing what its photograph shows.`,
  ].join("\n");
}

/** The first JSON object in the answer, parsed against the caption schema; null when there is none. */
function parseAnswer(text: string): Captions | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end < start) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  const parsed = answerSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function lintAnswer(answer: Captions, property: CaptionProperty): string[] {
  return CHANNELS.flatMap((channel) =>
    lintCaption(answer[channel], property, channel).map((issue) => `${channel}: ${issue.message}`),
  );
}

/** One alt text per planned slide, whatever the model counted; a missing one falls back to its photograph's alt. */
function fitSlideAlts(answer: Captions, spec: CaptionSpec): Captions {
  return {
    ...answer,
    slide_alts: spec.slides.map(
      (slide, at) => answer.slide_alts[at] ?? spec.images[slide.image]?.alt ?? "",
    ),
  };
}

/**
 * Asks for the three variants and the alt texts, lints every variant, and asks once more with the failures. A first
 * answer that is not the caption JSON counts as a lint failure; a second one throws. A variant that still breaks a
 * rule after the second answer is returned with `caption_lint: "failed"` (invariant 5).
 */
export async function writeCaptions(
  property: CaptionProperty,
  spec: CaptionSpec,
  deps: CaptionDeps,
): Promise<WrittenCaptions> {
  const usage = { model: deps.model, input_tokens: 0, output_tokens: 0 };
  const ask = async (prompt: string): Promise<string> => {
    const answered = await deps.complete(prompt, deps.signal);
    usage.input_tokens += answered.usage.input_tokens;
    usage.output_tokens += answered.usage.output_tokens;
    return answered.text;
  };

  const prompt = buildPrompt(property, spec);
  const firstText = await ask(prompt);
  const first = parseAnswer(firstText);
  const problems =
    first === null
      ? ["The answer was not one JSON object with the five keys."]
      : lintAnswer(first, property);
  if (first !== null && problems.length === 0) {
    return { captions: fitSlideAlts(first, spec), caption_lint: "passed", usage };
  }

  const second = parseAnswer(
    await ask(
      [
        prompt,
        "",
        "Your previous answer:",
        firstText,
        "",
        "It failed these checks:",
        ...problems.map((problem) => `- ${problem}`),
        "Answer again with one JSON object that fixes every point.",
      ].join("\n"),
    ),
  );
  if (second === null) throw new NonRetryableError("caption_answer_invalid");
  return {
    captions: fitSlideAlts(second, spec),
    caption_lint: lintAnswer(second, property).length === 0 ? "passed" : "failed",
    usage,
  };
}
