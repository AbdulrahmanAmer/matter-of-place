// W2 step 6 ("How the staff learns"): the pure rules of the staff's growth, used by the daemon and the weekly review.
// - Recall: every active lesson while a colleague holds 30 or fewer; past that, the 10 most relevant to this run
//   (a word overlap with what woke it, never below a floor of one shared word), then the most recent.
// - Cost: from the CLI's own token counts and our price table, never from the CLI's reported cost.
// - The fence: lessons are the operator's decisions, shown to the colleague as rules to follow.

export interface Lesson {
  id: string;
  trigger: string;
  action: string;
  uses: number;
  last_used_at: string | null;
  created_at: string;
  /** 'build' is Matter's own (W6 item 4); any other is the operator's decision. */
  source?: string;
}

const ALL_UNDER = 30;
const TOP = 10;
const FLOOR = 1;

function words(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length > 3),
  );
}

function recency(lesson: Lesson): number {
  return Date.parse(lesson.last_used_at ?? lesson.created_at);
}

/** The lessons a run is shown, newest first. */
export function recallLessons(lessons: readonly Lesson[], situation: string): Lesson[] {
  const byRecency = [...lessons].sort((a, b) => recency(b) - recency(a));
  if (lessons.length <= ALL_UNDER) return byRecency;
  const seen = words(situation);
  const scored = byRecency
    .map((lesson) => ({
      lesson,
      score: [...words(`${lesson.trigger} ${lesson.action}`)].filter((word) => seen.has(word))
        .length,
    }))
    .filter((entry) => entry.score >= FLOOR);
  return scored
    .sort((a, b) => b.score - a.score || recency(b.lesson) - recency(a.lesson))
    .slice(0, TOP)
    .map((entry) => entry.lesson);
}

/** The block of the prompt that carries the lessons; empty when there are none. */
export function lessonsBlock(lessons: readonly Lesson[]): string {
  const built = lessons.filter((lesson) => lesson.source === "build");
  const taught = lessons.filter((lesson) => lesson.source !== "build");
  const lines = (list: readonly Lesson[]) =>
    list.map((lesson) => `- ${lesson.trigger}: ${lesson.action}`);
  return [
    ...(taught.length === 0
      ? []
      : [
          "What the operator has taught you (from his decisions on your earlier drafts; follow these):",
          ...lines(taught),
        ]),
    ...(built.length === 0
      ? []
      : [
          "What your own earlier builds taught you (what broke in CI and what fixed it; do not make the same mistake twice):",
          ...lines(built),
        ]),
  ].join("\n");
}

/** US dollars per million tokens (ruling H96: list prices of the Claude 4.5 generation; UNPROVEN for 5.5). */
const PRICES: Record<string, { input: number; output: number }> = {
  opus: { input: 5, output: 25 },
  sonnet: { input: 3, output: 15 },
  haiku: { input: 1, output: 5 },
};

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | undefined;
  cache_read_input_tokens?: number | undefined;
}

/** What a run cost in millionths of a dollar: cache writes at 1.25 times input, cache reads at a tenth. */
export function costMicroUsd(model: string, usage: Usage): number {
  const price = PRICES[model] ?? PRICES["sonnet"] ?? { input: 3, output: 15 };
  const input =
    usage.input_tokens +
    1.25 * (usage.cache_creation_input_tokens ?? 0) +
    0.1 * (usage.cache_read_input_tokens ?? 0);
  return Math.round(input * price.input + usage.output_tokens * price.output);
}

/** All the input a run read, for the input_tokens column. */
export function inputTokens(usage: Usage): number {
  return (
    usage.input_tokens +
    (usage.cache_creation_input_tokens ?? 0) +
    (usage.cache_read_input_tokens ?? 0)
  );
}
