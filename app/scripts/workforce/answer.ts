// What a colleague's run hands back: one JSON object at the end of its answer. The daemon acts on its fields.
// 2026-10-13 test 2 (P-3452): Matter's prose named `{{property_address}}`, the old reader cut from the first "{" and
// failed, and a proposal Matter said it had filed was dropped. The reader now tries each "{" until one parses.
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { jsonValue } from "../../src/domain/json-value.ts";
import { RENDERER_NAMES } from "../../src/domain/toolkits.ts";
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

/** Each bracket of `text` from `from` that stands outside every string, as JSON reads it: its index and itself. */
function* bracketsFrom(text: string, from: number): Generator<[number, string]> {
  let inString = false;
  for (let at = from; at < text.length; at += 1) {
    const char = text.charAt(at);
    if (inString) {
      if (char === "\\") at += 1;
      else if (char === '"') inString = false;
    } else if (char === '"') inString = true;
    else if ("{[]}".includes(char)) yield [at, char];
  }
}

/**
 * P-4691 round 4: the "{" that may start the answer's object, each outside every string and every bracket opened before
 * it, counted from the first "{". One inside an object left open is never read as the answer: with the final "}"
 * missing, a proposal (or a nested `"allow": true`, in a held read too) was read as the whole outcome.
 */
function objectStarts(text: string): Set<number> {
  const starts = new Set<number>();
  let depth = 0;
  for (const [at, char] of bracketsFrom(text, Math.max(text.indexOf("{"), 0))) {
    if (char === "{" && depth === 0) starts.add(at);
    depth = char === "{" || char === "[" ? depth + 1 : Math.max(depth - 1, 0);
  }
  return starts;
}

/**
 * The answer's closing JSON object, or why there is none: the parse error (or the first schema problem, by its path and
 * code only, never a value it received) of the widest object, the one that starts at the first "{" (P-4691).
 */
export function readOutcome(text: string): { outcome: Outcome } | { error: string } {
  const end = text.lastIndexOf("}");
  const starts = objectStarts(text);
  let error: string | null = null;
  for (
    let start = text.indexOf("{");
    start >= 0 && start < end;
    start = text.indexOf("{", start + 1)
  ) {
    if (!starts.has(start)) continue;
    try {
      const raw: unknown = JSON.parse(text.slice(start, end + 1));
      const parsed = outcome.safeParse(raw);
      if (parsed.success) return { outcome: parsed.data };
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

/** The thread line of a run whose answer could not be read (P-4691). */
export const UNREADABLE_LINE =
  "This run's answer could not be read, so no proposal, hire or action from it was filed.";

/** And the run's recorded ending, in fixed words whatever the run's shape (an outside run's summary is fixed too). */
export const UNREADABLE_SUMMARY = "Its answer could not be read; nothing filed";

/**
 * P-4691 round 4 (Matter, 2026-10-28: no model rewrites an answer; three reviews in a row found a retry could still
 * move a value between containers). The repairs of the answer's object, from its first "{" to its end (a closing fence
 * aside), each one edit of a closing bracket outside every string, so no key, value, quote, comma or opener is added,
 * removed or moved: at the first closer of the wrong kind for its opener, (a) its kind changed, or (d) it taken out
 * (Julian's answer had one `]` too many, so no kind change parses it); with none, (b) the closers still owed appended at
 * the end, or (c) the extra closers at the end taken out. A kind change anywhere else cannot parse: every closer before
 * that one matches, and after it the wrong one stays.
 */
function repairs(text: string): string[] {
  const from = text.indexOf("{");
  if (from < 0) return [];
  const body = text.slice(from).replace(/\s*(```\s*)?$/, "");
  const owed: string[] = [];
  for (const [at, char] of bracketsFrom(body, 0)) {
    if (char === "{" || char === "[") {
      owed.push(char === "{" ? "}" : "]");
      continue;
    }
    const closes = owed.pop();
    // the object is closed: only extra closers may follow, and they go (c)
    if (closes === undefined) return /^[\s}\]]*$/.test(body.slice(at)) ? [body.slice(0, at)] : [];
    if (char !== closes)
      return [
        `${body.slice(0, at)}${closes}${body.slice(at + 1)}`,
        `${body.slice(0, at)}${body.slice(at + 1)}`,
      ];
  }
  // a body that ends inside a string gets its closers inside that string, and does not parse
  return owed.length === 0 ? [] : [`${body}${owed.reverse().join("")}`];
}

/** A candidate's outcome, or null when it does not parse or does not match the answer's fields. */
function outcomeOf(candidate: string): Outcome | null {
  try {
    const raw: unknown = JSON.parse(candidate);
    const parsed = outcome.safeParse(raw);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * P-4691 (W9 item 3, 2026-10-27: the Editor's fenced object had one bracket too many, its raw text was posted as the
 * line and the proposal it described was never filed): a run's answer, read; one that is not a valid outcome is taken
 * only through `repairs`, and only when every repair that parses and matches the fields gives the same outcome (of the
 * four kinds at most one ever parses, a closer changed and one taken out owing different counts after it). Else,
 * or when `repair` is false (a held read or an explanation, fail closed, W8 0d), it is the plain `UNREADABLE_LINE` and
 * nothing that acts, never the raw text.
 */
export function readRunAnswer(
  text: string,
  repair: boolean,
): { outcome: Outcome; ending: "read" | "repaired" | "unreadable" } {
  const first = readOutcome(text);
  if ("outcome" in first) return { outcome: first.outcome, ending: "read" };
  const read = (repair ? repairs(text) : []).flatMap((candidate) => outcomeOf(candidate) ?? []);
  const [one] = read;
  if (one !== undefined && read.every((other) => isDeepStrictEqual(other, one)))
    return { outcome: one, ending: "repaired" };
  return { outcome: { ...readJsonAnswer(""), reply: UNREADABLE_LINE }, ending: "unreadable" };
}
