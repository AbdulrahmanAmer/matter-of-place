import { describe, expect, it } from "vitest";
import {
  costMicroUsd,
  inputTokens,
  lessonsBlock,
  recallLessons,
  type Lesson,
} from "../../scripts/workforce/growth";
import {
  adopt,
  changeBody,
  mergedInstructions,
  promotable,
  weekStats,
} from "../../scripts/workforce/review";

// W2 step 6: how the staff learns. Recall with a cap and a floor, cost from our own prices, and the weekly review that
// promotes a lesson used often into the instructions only when a replay says it helps.

const lesson = (n: number, text: string, daysAgo = n): Lesson => ({
  id: `l${String(n)}`,
  trigger: "When you draft a reply to an inquiry",
  action: text,
  uses: 0,
  last_used_at: null,
  created_at: new Date(Date.UTC(2026, 9, 12) - daysAgo * 86_400_000).toISOString(),
});

describe("recall", () => {
  it("shows every lesson, newest first, while a colleague holds 30 or fewer", () => {
    const lessons = [lesson(3, "three"), lesson(1, "one"), lesson(2, "two")];
    expect(recallLessons(lessons, "anything").map((item) => item.id)).toEqual(["l1", "l2", "l3"]);
  });

  it("past 30, shows the 10 most relevant to the run and none below the floor", () => {
    const lessons = Array.from({ length: 40 }, (_, n) =>
      lesson(n, `generic advice number ${String(n)}`),
    );
    lessons.push(lesson(50, "mention the property's garden and the ocean view"));
    lessons.push(lesson(51, "never promise buyers"));
    const shown = recallLessons(
      lessons,
      "A buyer asks about the garden and the ocean view of the Malibu home",
    );
    expect(shown[0]?.id).toBe("l50");
    expect(shown.length).toBeLessThanOrEqual(10);
    expect(shown.every((item) => !item.action.startsWith("generic"))).toBe(true);
  });

  it("writes the lessons as rules to follow, and nothing when there are none", () => {
    expect(lessonsBlock([])).toBe("");
    expect(lessonsBlock([lesson(1, "Keep it to three sentences.")])).toContain(
      "- When you draft a reply to an inquiry: Keep it to three sentences.",
    );
  });
});

describe("cost", () => {
  it("prices a run from its tokens with our own table, cache reads at a tenth", () => {
    const usage = { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 10_000 };
    expect([
      costMicroUsd("sonnet", usage),
      costMicroUsd("opus", usage),
      inputTokens(usage),
    ]).toEqual([3 * 2000 + 15 * 500, 5 * 2000 + 25 * 500, 11_000]);
  });
});

describe("the weekly review", () => {
  it("counts the week's outcomes and the approved-as-is rate", () => {
    expect(
      weekStats([
        { state: "approved", edited: false },
        { state: "approved", edited: true },
        { state: "rejected", edited: false },
        { state: "approved", edited: false },
        { state: "pending", edited: false },
      ]),
    ).toEqual({ decided: 4, asIs: 2, edited: 1, declined: 1, asIsRate: 0.5 });
  });

  it("promotes only active lessons used three times or more, written once into the instructions", () => {
    const lessons = [
      {
        id: "a",
        trigger: "When you post",
        action: "Lead with the place.",
        uses: 3,
        status: "active",
      },
      { id: "b", trigger: "When you post", action: "Short captions.", uses: 2, status: "active" },
      { id: "c", trigger: "When you post", action: "Old rule.", uses: 9, status: "retired" },
    ];
    const chosen = promotable(lessons);
    const next = mergedInstructions("Write for Instagram.", chosen);
    expect([chosen.map((item) => item.id), next, mergedInstructions(next, chosen)]).toEqual([
      ["a"],
      "Write for Instagram.\n\nWhat the operator has taught you, kept for good:\n- When you post: Lead with the place.",
      next,
    ]);
  });

  it("adopts a change only when the new instructions won the replay, or when there was nothing to replay", () => {
    expect([
      adopt({ cases: 0, newWins: 0, oldWins: 0 }),
      adopt({ cases: 4, newWins: 3, oldWins: 1 }),
      adopt({ cases: 4, newWins: 2, oldWins: 2 }),
      adopt({ cases: 3, newWins: 0, oldWins: 3 }),
    ]).toEqual([true, true, false, false]);
    expect(
      changeBody({
        slug: "concierge",
        lessons: [
          {
            id: "a",
            trigger: "When you reply",
            action: "Name the property.",
            uses: 4,
            status: "active",
          },
        ],
        replay: { cases: 2, newWins: 2, oldWins: 0 },
      }),
    ).toContain("came closer to your version 2 times, the old ones 0 times");
  });
});
