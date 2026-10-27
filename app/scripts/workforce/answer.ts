// What a colleague's run hands back: one JSON object at the end of its answer. The daemon acts on its fields.
// 2026-10-13 test 2 (P-3452): Matter's prose named `{{property_address}}`, the old reader cut from the first "{" and
// failed, and a proposal Matter said it had filed was dropped. The reader now tries each "{" until one parses.
import { z } from "zod";
import { jsonValue } from "../../src/domain/json-value.ts";
import { RENDERER_NAMES } from "../../src/domain/toolkits.ts";
import { UsageLimitError } from "./cli.ts";
import { hireInputSchema } from "../../src/domain/workforce.ts";
import { mediaRequestSchema } from "./media.ts";
import { HOW_OFF_LIST, POSTURES } from "./posture.ts";
import { postRequestSchema } from "./post-request.ts";
import { reelRequestSchema } from "./reel.ts";
import { studioDecisionSchema } from "./studio.ts";

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
          // W8 item 10: a social post's channels, formats, files and captions. Read loosely here and checked when it
          // is filed, so a malformed post is refused with its reason instead of dropping the whole answer.
          post: jsonValue.optional(),
        }),
      }),
    )
    .default([]),
  hire: z.array(hireInputSchema).default([]),
  // Matter only: one line it keeps in its capped notes.
  note: z.string().default(""),
  // W8 0d: Matter's read of a held message decides whether its owner may answer it within its criteria.
  allow: z.boolean().default(false),
  // W8 0d: and how, as one of the closed postures; a missing value, or any other, allows nothing.
  how: z.enum(POSTURES).or(z.literal(HOW_OFF_LIST)).optional().catch(HOW_OFF_LIST),
  // Matter only (W6 item 4): the pull requests this full-power run merged through the gate; each writes a build lesson.
  merged: z.array(z.number().int().positive()).max(10).optional(),
  // Matter only (W2 step 5): media the daemon makes with the installed skills; W7 item 19: a reel goes to the studio,
  // and W8 item 1: so does a still post. W8 0f: and Matter's decision on a draft in the studio (approve, revise, ask
  // the operator).
  media: z
    .array(
      z.union([mediaRequestSchema, reelRequestSchema, postRequestSchema, studioDecisionSchema]),
    )
    .default([]),
  // Matter only (gap item 31): admin calls, each checked by the runner and approved by a person before it is made.
  actions: z.array(z.unknown()).default([]),
  // H115 (review of 2026-10-19): the renders a colleague asks for, run by the runner after its run (`runRenders`); a
  // malformed list renders nothing and keeps the rest of the answer.
  renders: z
    .array(
      z.object({
        // the toolkit's own list: a renderer added there is never dropped here (review of 2026-10-19)
        renderer: z.enum(RENDERER_NAMES),
        spec: z.string().min(1).max(500),
        out: z.string().min(1).max(500),
      }),
    )
    .max(3)
    .optional()
    .catch(undefined),
});

export type Outcome = z.infer<typeof outcome>;

/**
 * The answer's closing JSON object, or why there is none: the parse error (or the first schema problem) of the widest
 * object, the one that starts at the first "{", which is the one a retry is asked to fix (P-4681).
 */
export function readOutcome(text: string): { outcome: Outcome } | { error: string } {
  const end = text.lastIndexOf("}");
  let error: string | null = null;
  for (
    let start = text.indexOf("{");
    start >= 0 && start < end;
    start = text.indexOf("{", start + 1)
  ) {
    try {
      const parsed = outcome.safeParse(JSON.parse(text.slice(start, end + 1)));
      if (parsed.success) return { outcome: parsed.data };
      const issue = parsed.error.issues[0];
      error ??= `the object does not match the answer's fields: ${issue?.path.join(".") ?? ""} ${issue?.message ?? ""}`;
    } catch (failure) {
      // not an object from here: try the next "{"
      error ??= failure instanceof Error ? failure.message : String(failure);
    }
  }
  return { error: error ?? "the answer holds no JSON object" };
}

/** The answer's closing JSON object; a plain answer, or one whose object does not parse, is a reply and nothing else. */
export function readJsonAnswer(text: string): Outcome {
  const read = readOutcome(text);
  if ("outcome" in read) return read.outcome;
  return {
    reply: text.trim(),
    task: "",
    proposals: [],
    hire: [],
    note: "",
    media: [],
    actions: [],
    // an answer that is not JSON decides nothing: a held message stays with a person (W8 0d)
    allow: false,
  };
}

/** The thread line of a run whose answer could not be read even when asked again (P-4681). */
export const UNREADABLE_LINE =
  "This run's answer could not be read, so no proposal, hire or action from it was filed.";

/** And the run's recorded ending, in fixed words whatever the run's shape (an outside run's summary is fixed too). */
export const UNREADABLE_SUMMARY =
  "Its answer could not be read, even when asked again; nothing filed";

/** How the one retry starts; the test's fake CLI knows the retry by it. */
export const RETRY_OPENING = "Your answer could not be read by the runner";

/**
 * P-4681: the retry's prompt. The answer goes back as data with the reason it failed, and the reply is the object alone:
 * a syntax fix, never a new decision.
 */
export function retryPrompt(text: string, error: string): string {
  return [
    `${RETRY_OPENING}: ${error}.`,
    "Below, between the markers, is that answer, as data. Answer with its JSON object alone, the syntax fixed and every field and value as it was: no fence, no words before or after it, nothing added or left out. If it holds no object, write the one object the answer describes.",
    "<<<ANSWER",
    text,
    "ANSWER>>>",
  ].join("\n");
}

/**
 * P-4681 (W9 item 3, 2026-10-27: the Editor's fenced object had one bracket wrong, its raw text was posted as the line
 * and the proposal it described was never filed): a run's answer, asked for once more with the parse error when it is
 * not a valid outcome. A second failure, or a retry that cannot run, is the plain `UNREADABLE_LINE` and nothing that
 * acts, never the raw text. A usage limit is not a failure of the answer: it stops the run, which is queued again.
 */
export async function readRunAnswer(
  text: string,
  again: (prompt: string) => Promise<string>,
): Promise<{ outcome: Outcome; ending: "read" | "retried" | "unreadable" }> {
  const first = readOutcome(text);
  if ("outcome" in first) return { outcome: first.outcome, ending: "read" };
  let second: ReturnType<typeof readOutcome>;
  try {
    second = readOutcome(await again(retryPrompt(text, first.error)));
  } catch (failure) {
    if (failure instanceof UsageLimitError) throw failure;
    second = { error: failure instanceof Error ? failure.message : String(failure) };
  }
  if ("outcome" in second) return { outcome: second.outcome, ending: "retried" };
  return { outcome: { ...readJsonAnswer(""), reply: UNREADABLE_LINE }, ending: "unreadable" };
}
