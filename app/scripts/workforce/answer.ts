// What a colleague's run hands back: one JSON object at the end of its answer. The daemon acts on its fields.
// 2026-10-13 test 2 (P-3452): Matter's prose named `{{property_address}}`, the old reader cut from the first "{" and
// failed, and a proposal Matter said it had filed was dropped. The reader now tries each "{" until one parses.
import { z } from "zod";
import { hireInputSchema } from "../../src/domain/workforce.ts";
import { mediaRequestSchema } from "./media.ts";
import { reelRequestSchema } from "./reel.ts";

export const outcome = z.object({
  reply: z.string().default(""),
  task: z.string().default(""),
  proposals: z
    .array(
      z.object({
        action: z.enum(["reply_inquiry", "social_post", "newsletter_issue", "campaign_plan"]),
        summary: z.string().min(1).max(500),
        content: z.object({
          body: z.string().min(1).max(20000),
          to: z.string().max(300).optional(),
        }),
      }),
    )
    .default([]),
  hire: z.array(hireInputSchema).default([]),
  // Matter only: one line it keeps in its capped notes.
  note: z.string().default(""),
  // Matter only (W2 step 5): media the daemon makes with the installed skills; W7 item 19: a reel goes to the studio.
  media: z.array(z.union([mediaRequestSchema, reelRequestSchema])).default([]),
  // Matter only (gap item 31): admin calls, each checked by the runner and approved by a person before it is made.
  actions: z.array(z.unknown()).default([]),
});

export type Outcome = z.infer<typeof outcome>;

/** The answer's closing JSON object; a plain answer, or one whose object does not parse, is a reply and nothing else. */
export function readJsonAnswer(text: string): Outcome {
  const end = text.lastIndexOf("}");
  for (
    let start = text.indexOf("{");
    start >= 0 && start < end;
    start = text.indexOf("{", start + 1)
  ) {
    try {
      const parsed = outcome.safeParse(JSON.parse(text.slice(start, end + 1)));
      if (parsed.success) return parsed.data;
    } catch {
      // not an object from here: try the next "{"
    }
  }
  return {
    reply: text.trim(),
    task: "",
    proposals: [],
    hire: [],
    note: "",
    media: [],
    actions: [],
  };
}
