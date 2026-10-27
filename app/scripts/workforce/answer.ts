// What a colleague's run hands back: one JSON object at the end of its answer. The daemon acts on its fields.
// 2026-10-13 test 2 (P-3452): Matter's prose named `{{property_address}}`, the old reader cut from the first "{" and
// failed, and a proposal Matter said it had filed was dropped. The reader now tries each "{" until one parses.
import { z } from "zod";
import { jsonValue } from "../../src/domain/json-value.ts";
import { RENDERER_NAMES } from "../../src/domain/toolkits.ts";
import { UsageLimitError } from "./cli.ts";
import { fenced } from "../matter/run.ts";
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
 * The answer's closing JSON object (with the object as written, `raw`), or why there is none: the parse error (or the
 * first schema problem, by its path and code only, never a value it received) of the widest object, the one that starts
 * at the first "{", which is the one a retry is asked to fix (P-4691).
 */
export function readOutcome(text: string): { outcome: Outcome; raw: unknown } | { error: string } {
  const end = text.lastIndexOf("}");
  let error: string | null = null;
  for (
    let start = text.indexOf("{");
    start >= 0 && start < end;
    start = text.indexOf("{", start + 1)
  ) {
    try {
      const raw: unknown = JSON.parse(text.slice(start, end + 1));
      const parsed = outcome.safeParse(raw);
      if (parsed.success) return { outcome: parsed.data, raw };
      const issue = parsed.error.issues[0];
      error ??= `the object does not match the answer's fields: ${issue?.path.join(".") ?? ""} ${issue?.code ?? ""}`;
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

/** The thread line of a run whose answer could not be read even when asked again (P-4691). */
export const UNREADABLE_LINE =
  "This run's answer could not be read, so no proposal, hire or action from it was filed.";

/** And the run's recorded ending, in fixed words whatever the run's shape (an outside run's summary is fixed too). */
export const UNREADABLE_SUMMARY =
  "Its answer could not be read, even when asked again; nothing filed";

/** How the one retry starts; the test's fake CLI knows the retry by it. */
export const RETRY_OPENING = "Your answer could not be read by the runner";

/**
 * P-4691: the retry's prompt. The answer and the reason it failed go back fenced as data (`fenced`: a closing mark
 * inside the answer closes nothing, and a value the parse error quotes stays inside a fence), and the reply is the
 * object alone: a syntax fix, never a new decision.
 */
export function retryPrompt(text: string, error: string): string {
  return [
    `${RETRY_OPENING}. Below, each between its markers and as data, are why and the answer itself.`,
    fenced("WHY", error),
    fenced("ANSWER", text),
    "Answer with the answer's JSON object alone, the syntax fixed and every field and value as it was: no fence, no words before or after it, nothing added or left out.",
  ].join("\n");
}

/** The index of the first character that is not white space, from `at` going `step` (-1 or `text.length` past an end). */
function nonSpace(text: string, at: number, step: 1 | -1): number {
  let index = at;
  while (index >= 0 && index < text.length && /\s/.test(text.charAt(index))) index += step;
  return index;
}

/**
 * P-4691 round 3 (fresh review, 2026-10-28; Matter's rule: a retry may change only punctuation). Round 2 asked only
 * that each piece occur somewhere in the original, so a retry could rebuild the object from fragments: a value moved
 * between keys (a studio decision `revise` handed back as `approve`), a slice of a string, an element twice, a number
 * from the digits of a date. Now the retried object's tokens, in their written order, each stand in `original` at an
 * increasing position from its first "{", between JSON punctuation: each key as `"key"` (after a "{" or ",", before a
 * ":"), each string whole and quoted (JSON-escaped or as written), each number, `true`, `false` and `null` whole, and a
 * key's own value right after its ":" (so `allow: true` only where the original wrote `"allow": true`).
 */
function tracesIn(original: string, retried: unknown): boolean {
  let pos = original.indexOf("{");
  const take = (
    forms: readonly string[],
    before: string,
    after: string,
    pinned: boolean,
  ): boolean => {
    const fits = (form: string, at: number): boolean => {
      const prev = original.charAt(nonSpace(original, at - 1, -1));
      const next = original.charAt(nonSpace(original, at + form.length, 1));
      return prev !== "" && before.includes(prev) && (next === "" || after.includes(next));
    };
    // a key's own value starts at the first character after its ":"
    const own = nonSpace(original, nonSpace(original, pos, 1) + 1, 1);
    let found = -1;
    let end = -1;
    for (const form of forms) {
      let at = pinned ? own : original.indexOf(form, pos);
      while (at >= 0 && !(original.startsWith(form, at) && fits(form, at)))
        at = pinned ? -1 : original.indexOf(form, at + 1);
      if (at >= 0 && (found < 0 || at < found)) [found, end] = [at, at + form.length];
    }
    if (found >= 0) pos = end;
    return found >= 0;
  };
  const walk = (value: unknown, keyed: boolean): boolean => {
    if (Array.isArray(value)) return value.every((item) => walk(item, false));
    if (typeof value === "object" && value !== null)
      return Object.entries(value).every(
        ([key, field]) => take([JSON.stringify(key)], "{,", ":", false) && walk(field, true),
      );
    const forms =
      typeof value === "string" ? [JSON.stringify(value), `"${value}"`] : [JSON.stringify(value)];
    return take(forms, keyed ? ":" : ":[,", ",]}", keyed);
  };
  return pos >= 0 && walk(retried, false);
}

/**
 * A retried object counts only if it traces to the run's own answer (`tracesIn`), as written or as the retry saw it
 * through the fence, whose replacement turns a ">>>" the run wrote into "> > >".
 */
export function tracesTo(original: string, retried: unknown): boolean {
  const fence = fenced("", original);
  const asSeen = fence.slice(fence.indexOf("\n") + 1, fence.lastIndexOf("\n"));
  return tracesIn(original, retried) || tracesIn(asSeen, retried);
}

/** The one retry, read: its outcome and the object as written, or null when it cannot be read or cannot run. */
async function askedAgain(
  text: string,
  error: string,
  again: (prompt: string) => Promise<string>,
): Promise<{ outcome: Outcome; raw: unknown } | null> {
  try {
    const second = readOutcome(await again(retryPrompt(text, error)));
    return "outcome" in second ? second : null;
  } catch (failure) {
    if (failure instanceof UsageLimitError) throw failure;
    return null;
  }
}

/**
 * P-4691 (W9 item 3, 2026-10-27: the Editor's fenced object had one bracket wrong, its raw text was posted as the line
 * and the proposal it described was never filed): a run's answer, asked for once more with the parse error when it is
 * not a valid outcome. A second failure, or a retry that cannot run, is the plain `UNREADABLE_LINE` and nothing that
 * acts, never the raw text. A usage limit is not a failure of the answer: it stops the run, which is queued again.
 * Round 2 (fresh review, 2026-10-28): only an answer that holds a "{" is asked again, never one whose `again` is null (a
 * held read or an explanation, fail closed, W8 0d), and the retried object counts only if it `tracesTo` the original.
 */
export async function readRunAnswer(
  text: string,
  again: ((prompt: string) => Promise<string>) | null,
): Promise<{ outcome: Outcome; ending: "read" | "retried" | "unreadable" }> {
  const first = readOutcome(text);
  if ("outcome" in first) return { outcome: first.outcome, ending: "read" };
  const second =
    again === null || !text.includes("{") ? null : await askedAgain(text, first.error, again);
  if (second !== null && tracesTo(text, second.raw))
    return { outcome: second.outcome, ending: "retried" };
  return { outcome: { ...readJsonAnswer(""), reply: UNREADABLE_LINE }, ending: "unreadable" };
}
