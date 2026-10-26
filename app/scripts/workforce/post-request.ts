// W8 item 1: what a still post about the brand, a market or a story asks for, and the frames each format is shot at.
// The studio queue (`reel.ts`) reads it beside a reel request; the post pass (`brand-post.ts`) makes it. Pure: no
// import from either, so both may import it.
import { z } from "zod";
import type { AssetFile } from "../../src/domain/assets.ts";
import { marketSlugSchema } from "../../src/domain/market.ts";

export const postKinds = ["coming_soon", "market_note", "story_card", "interest"] as const;
type PostKind = (typeof postKinds)[number];

/** The asset kinds a still post is recorded as, each with B9's roles so Visuals and the posting path read it alike. */
export const postFormats = ["carousel", "story", "cover"] as const;
type PostFormat = (typeof postFormats)[number];

/** Each piece's format unless the request names one: the four pieces of item 1 never share a frame. */
export const defaultFormat = {
  coming_soon: "carousel",
  market_note: "carousel",
  story_card: "cover",
  interest: "story",
} as const satisfies Record<PostKind, PostFormat>;

/** What a post is about (E1's `assets.subject`): a coming-soon post is the brand's, a market note or an interest post its market's. */
export const postSubjectOf = {
  coming_soon: "brand",
  market_note: "market",
  story_card: "story",
  interest: "market",
} as const satisfies Record<PostKind, string>;

const EM_DASH = String.fromCharCode(0x2014);
const line = z
  .string()
  .min(1)
  .max(120)
  .refine((text) => !text.includes(EM_DASH), "no em dashes");

export const postRequestSchema = z
  .object({
    skill: z.literal("post"),
    name: z.string().min(1).max(60),
    kind: z.enum(postKinds),
    format: z.enum(postFormats).optional(),
    // the words on the piece: one per slide of a carousel, one to three on a story or a cover
    titles: z.array(line).min(1).max(6),
    market: marketSlugSchema.optional(),
    story_id: z.string().uuid().optional(),
    // Instagram's caption; X's and LinkedIn's carry no link, the pass adds the post's own (`brandLink`)
    caption: z.string().min(1).max(2200),
    captions: z
      .object({
        x: z.string().min(1).max(250).optional(),
        linkedin: z.string().min(1).max(2900).optional(),
      })
      .optional(),
  })
  .superRefine((request, ctx) => {
    const needs = postSubjectOf[request.kind];
    if (needs === "market" && request.market === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["market"],
        message: `a ${request.kind} post names its market`,
      });
    }
    if (needs !== "market" && request.market !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["market"],
        message: `a ${request.kind} post names no market`,
      });
    }
    if (needs === "story" && request.story_id === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["story_id"],
        message: "a story card names its story_id",
      });
    }
    if (needs !== "story" && request.story_id !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["story_id"],
        message: `a ${request.kind} post names no story`,
      });
    }
    const format = request.format ?? defaultFormat[request.kind];
    const [least, most] = format === "carousel" ? [2, 6] : [1, 3];
    if (request.titles.length < least || request.titles.length > most) {
      ctx.addIssue({
        code: "custom",
        path: ["titles"],
        message:
          format === "carousel"
            ? "a carousel has one title per slide, 2 to 6"
            : `a ${format} carries 1 to 3 titles`,
      });
    }
  });
export type PostRequest = z.infer<typeof postRequestSchema>;

export interface Frame {
  name: string;
  role: AssetFile["role"];
  index?: number;
  width: number;
  height: number;
}

/** The frames of a format, at B9's sizes and roles: a carousel's 1080 x 1350 slides, a story, a cover and its crops. */
export function framesFor(format: PostFormat, titles: readonly string[]): Frame[] {
  if (format === "carousel") {
    return titles.map((_, index) => ({
      name: `slide-${String(index)}`,
      role: "slide",
      index,
      width: 1080,
      height: 1350,
    }));
  }
  if (format === "story") return [{ name: "story", role: "main", width: 1080, height: 1920 }];
  return [
    { name: "cover", role: "main", width: 1200, height: 630 },
    { name: "cover-x", role: "x", width: 1200, height: 675 },
    { name: "cover-linkedin", role: "linkedin", width: 1200, height: 627 },
  ];
}
