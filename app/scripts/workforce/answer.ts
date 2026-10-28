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

const proposalContent = z.object({
  body: z.string().min(1).max(20000),
  to: z.string().max(300).optional(),
  // W8 item 10: a social post's channels, formats, files and captions. Read loosely here and checked when it
  // is filed, so a malformed post is refused with its reason instead of dropping the whole answer.
  post: jsonValue.optional(),
});

const proposal = z.object({
  action: z.enum(["reply_inquiry", "social_post", "newsletter_issue", "campaign_plan"]),
  summary: z.string().min(1).max(500),
  content: proposalContent,
});

export const outcome = z.object({
  reply: z.string().default(""),
  task: z.string().default(""),
  proposals: z.array(proposal).default([]),
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
 * P-4691 round 5: a repaired answer is read strictly, a key the outcome does not define refused at every level it
 * defines, so a `to` or `post` moved out of `content` by a bracket fails instead of being stripped. Actions are free
 * shapes: there only the agreement of every reading guards.
 */
const strictOutcome = outcome
  .extend({
    proposals: z.array(proposal.extend({ content: proposalContent.strict() }).strict()).default([]),
  })
  .strict();

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
 * How far the JSON object or array that opens at `from` reads as JSON: `closed` just past its end, `invalid` at the
 * first character that cannot continue it (`wrongCloser` when that is a closer of the other kind where its own closer
 * could stand), or `end` with the text ending inside it: the closers it still owes, and whether they may follow now
 * (never inside a string, a number or a literal, nor after a key, a ":" or a ",": P-4691 round 5, a cut answer).
 */
type ValueRead =
  | { stop: "closed" | "invalid"; at: number; wrongCloser: boolean }
  | { stop: "end"; owed: string; closable: boolean };

const JSON_NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;

/** The closing `"` of the string that opens at `from`, -1 when the text ends inside it, or the invalid character. */
function stringEnd(text: string, from: number): { close: number } | { invalid: number } {
  for (let at = from + 1; at < text.length;) {
    const char = text.charAt(at);
    if (char === '"') return { close: at };
    if (char.charCodeAt(0) < 0x20) return { invalid: at };
    if (char !== "\\") {
      at += 1;
      continue;
    }
    const escaped = text.charAt(at + 1);
    if (escaped === "u") {
      const hex = text.slice(at + 2, at + 6);
      if (!/^[\da-fA-F]*$/.test(hex)) return { invalid: at + 2 };
      at += 6;
    } else if (escaped === "" || '"\\/bfnrt'.includes(escaped)) at += 2;
    else return { invalid: at + 1 };
  }
  return { close: -1 };
}

function readValue(text: string, from: number): ValueRead {
  const owed: string[] = [];
  // what may come next; `opened` right after an opener, where its own closer may come at once
  let want: "value" | "key" | "colon" | "after" = "value";
  let opened = false;
  const invalid = (at: number, wrongCloser = false): ValueRead => ({
    stop: "invalid",
    at,
    wrongCloser,
  });
  const cut: ValueRead = { stop: "end", owed: "", closable: false };
  let at = from;
  while (at < text.length) {
    const char = text.charAt(at);
    if (" \t\n\r".includes(char)) {
      at += 1;
      continue;
    }
    const wanted = want;
    const justOpened = opened;
    opened = false;
    if (char === "}" || char === "]") {
      const closes = owed.at(-1);
      if (closes === undefined || (wanted !== "after" && !justOpened)) return invalid(at);
      if (char !== closes) return invalid(at, true);
      owed.pop();
      at += 1;
      want = "after";
      if (owed.length === 0) return { stop: "closed", at, wrongCloser: false };
    } else if ((char === "{" || char === "[") && wanted === "value") {
      owed.push(char === "{" ? "}" : "]");
      want = char === "{" ? "key" : "value";
      opened = true;
      at += 1;
    } else if (char === '"' && (wanted === "value" || wanted === "key")) {
      const string = stringEnd(text, at);
      if ("invalid" in string) return invalid(string.invalid);
      if (string.close < 0) return cut;
      at = string.close + 1;
      want = wanted === "key" ? "colon" : "after";
    } else if (char === ":" && wanted === "colon") {
      want = "value";
      at += 1;
    } else if (char === "," && wanted === "after") {
      want = owed.at(-1) === "}" ? "key" : "value";
      at += 1;
    } else if (wanted === "value" && (char === "-" || (char >= "0" && char <= "9"))) {
      JSON_NUMBER.lastIndex = at;
      const number = JSON_NUMBER.exec(text)?.[0] ?? "";
      // a number the text ends in may be cut short (`[51` of `[512`)
      if (at + Math.max(number.length, 1) >= text.length) return cut;
      if (number === "") return invalid(at);
      at += number.length;
      want = "after";
    } else if (wanted === "value" && "tfn".includes(char)) {
      const literal = ["true", "false", "null"].find((word) => word.startsWith(char)) ?? "";
      if (text.startsWith(literal, at)) {
        at += literal.length;
        want = "after";
      } else if (literal.startsWith(text.slice(at, at + literal.length))) return cut;
      else return invalid(at);
    } else return invalid(at);
  }
  return {
    stop: "end",
    owed: owed.slice().reverse().join(""),
    closable: owed.length > 0 && (want === "after" || opened),
  };
}

/**
 * P-4691 round 5: the "{" that may start the answer's object. One is refused only when an earlier "{", read fresh as
 * JSON from itself, still holds it: so no quote state is carried across the prose (round 4 read from the first "{" on,
 * and a `{{property_address}}` in a quoted phrase, an inch mark `12"` or a stray "{" hid the real object), and an object
 * nested in one left open is never read as the answer (with the final "}" missing, a proposal or a nested
 * `"allow": true` was once read as the whole outcome). Nor is any "{" after a closer of the wrong kind: the answer's
 * object broke there, and what follows is still inside it.
 */
function objectStarts(text: string): number[] {
  const starts: number[] = [];
  const opens: number[] = [];
  for (let at = text.indexOf("{"); at >= 0; at = text.indexOf("{", at + 1)) opens.push(at);
  const inside = new Set<number>();
  let brokenAt = text.length;
  for (const at of opens) {
    if (!inside.has(at) && at < brokenAt) starts.push(at);
    const read = readValue(text, at);
    const until = read.stop === "end" ? text.length : read.at;
    for (const inner of opens) if (inner > at && inner < until) inside.add(inner);
    if (read.stop === "invalid" && read.wrongCloser) brokenAt = Math.min(brokenAt, read.at);
  }
  return starts;
}

/**
 * The answer's closing JSON object, or why there is none: the parse error (or the first schema problem, by its path and
 * code only, never a value it received) of the widest object, the first start `objectStarts` gives (P-4691).
 */
export function readOutcome(text: string): { outcome: Outcome } | { error: string } {
  const end = text.lastIndexOf("}");
  let error: string | null = null;
  for (const start of objectStarts(text)) {
    if (start >= end) break;
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
 * move a value between containers). The repairs of the answer's object, `body` from its start to its end (a closing
 * fence aside), each one edit of a closing bracket outside every string, so no key, value, quote, comma or opener is
 * added, removed or moved. At the first closer of the wrong kind, or with nothing left to close: round 5, every closer up
 * to and including it, its kind changed or it taken out (one `}` too many early closes `content` too soon, and the first
 * wrong closer is then a right one further on), and when only closers follow, those taken out (Julian's answer had one
 * `]` too many). With none: the closers still owed appended, only where a closer may stand (round 5: never after a
 * digit, a partial literal, a ":" or a ",", nor inside a string; an answer cut short is not one that forgot its brackets).
 */
function repairsFrom(body: string): string[] {
  const owed: string[] = [];
  const closers: number[] = [];
  for (const [at, char] of bracketsFrom(body, 0)) {
    if (char === "{" || char === "[") {
      owed.push(char === "{" ? "}" : "]");
      continue;
    }
    closers.push(at);
    const closes = owed.pop();
    if (char === closes) continue;
    const edits = closers.flatMap((one) => [
      `${body.slice(0, one)}${body.charAt(one) === "}" ? "]" : "}"}${body.slice(one + 1)}`,
      `${body.slice(0, one)}${body.slice(one + 1)}`,
    ]);
    const onlyClosersLeft = closes === undefined && /^[\s}\]]*$/.test(body.slice(at));
    return onlyClosersLeft ? [...edits, body.slice(0, at)] : edits;
  }
  const read = readValue(body, 0);
  return read.stop === "end" && read.closable ? [`${body}${read.owed}`] : [];
}

/**
 * P-4691 round 5: the start a repair reads from, of those `readOutcome` tries, the first that reads as JSON up to a
 * bracket: to the text's end, closed with a ",", or a closer next, or broken at a closer or after one (a closer written
 * wrong shows there or later). A `{{property_address}}` in the prose before it, broken at once, is passed over (round 4
 * repaired from the first "{" in the text).
 */
function repairStart(text: string): number | undefined {
  return objectStarts(text).find((start) => {
    const read = readValue(text, start);
    if (read.stop === "end") return true;
    if (read.stop === "closed") return /^\s*[,}\]]/.test(text.slice(read.at));
    for (const [at, char] of bracketsFrom(text, start)) {
      if (at > read.at) return false;
      if (char === "}" || char === "]") return true;
    }
    return false;
  });
}

/**
 * Each reading of a broken answer: of every repair that parses as JSON, its outcome read strictly, or null when the
 * strict fields refuse it (a reading that parses but means something else is a disagreement, never skipped).
 */
function readings(text: string): (Outcome | null)[] {
  const unfenced = text.replace(/\s*(```\s*)?$/, "");
  const start = repairStart(unfenced);
  if (start === undefined) return [];
  return Array.from(new Set(repairsFrom(unfenced.slice(start)))).flatMap((candidate) => {
    let raw: unknown;
    try {
      raw = JSON.parse(candidate);
    } catch {
      return [];
    }
    const strict = strictOutcome.safeParse(raw);
    return [strict.success ? strict.data : null];
  });
}

/**
 * P-4691 (W9 item 3, 2026-10-27: the Editor's fenced object had one bracket too many, its raw text was posted as the
 * line and the proposal it described was never filed): a run's answer, read; one that is not a valid outcome is taken
 * only through `readings`, and only when every repair that parses gives the same outcome under the strict fields. Else,
 * or when `repair` is false (a held read or an explanation, fail closed, W8 0d; a run cut off at its output limit), it is
 * the plain `UNREADABLE_LINE` and nothing that acts, never the raw text.
 */
export function readRunAnswer(
  text: string,
  repair: boolean,
): { outcome: Outcome; ending: "read" | "repaired" | "unreadable" } {
  const first = readOutcome(text);
  if ("outcome" in first) return { outcome: first.outcome, ending: "read" };
  const read = repair ? readings(text) : [];
  const [one] = read;
  // round 5: the agreement check is live, several closers are tried and two readings may differ
  const agreed = read.every((other) => isDeepStrictEqual(other, one));
  if (one !== undefined && one !== null && agreed) return { outcome: one, ending: "repaired" };
  return { outcome: { ...readJsonAnswer(""), reply: UNREADABLE_LINE }, ending: "unreadable" };
}
