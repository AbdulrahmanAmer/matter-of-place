import { describe, expect, it } from "vitest";
import {
  buildPreheader,
  buildSubject,
  orderBlocks,
  type Candidate,
} from "../../../src/server/newsletter/assemble";
import { propertyBlock, storyBlock, uuid } from "../../fixtures/newsletter-world";

// The subject and preheader come from rules, never from a model (S20): 60 and 110 characters, cut at a word, no em dash.

describe("buildSubject", () => {
  it("leads with the issue number and the title of the first block", () => {
    expect(buildSubject([propertyBlock(1, "Oak Hill")], 3)).toBe("Place Notes No. 3: Oak Hill");
  });

  it("is the lead alone with no block", () => {
    expect(buildSubject([], 3)).toBe("Place Notes No. 3");
  });

  it("is cut at a word to at most 60 characters", () => {
    const subject = buildSubject(
      [propertyBlock(1, "A long walled garden above the water in the old orchard district")],
      12,
    );
    expect(subject).toBe("Place Notes No. 12: A long walled garden above the water in");
    expect(subject.length).toBeLessThanOrEqual(60);
  });

  it("skips an intro block and replaces an em dash", () => {
    const intro = { id: "intro", type: "intro" as const, text: "Hello" };
    expect(buildSubject([intro, propertyBlock(1, "Oak Hill — Elmwood")], 1)).toBe(
      "Place Notes No. 1: Oak Hill, Elmwood",
    );
  });
});

describe("buildPreheader", () => {
  it("is the deck of the first block", () => {
    expect(buildPreheader([propertyBlock(1, "Oak Hill", "A quiet street.")])).toBe(
      "A quiet street.",
    );
  });

  it("is empty with no block", () => {
    expect(buildPreheader([])).toBe("");
  });

  it("is cut at a word to at most 110 characters with no em dash", () => {
    const deck = `${"A quiet street under old oaks — the garden runs down to the creek, ".repeat(3)}and the light stays late.`;
    const preheader = buildPreheader([propertyBlock(1, "Oak Hill", deck)]);
    expect(preheader.length).toBeLessThanOrEqual(110);
    expect(preheader).not.toContain("—");
    expect(preheader).toBe(
      "A quiet street under old oaks, the garden runs down to the creek, A quiet street under old oaks, the garden",
    );
  });
});

describe("orderBlocks", () => {
  const entry = (block: Candidate["block"], publishedAt: string, campaign = false): Candidate => ({
    block,
    publishedAt,
    campaign,
  });

  it("puts Campaign properties first, then properties newest first, then stories", () => {
    const ordered = orderBlocks([
      entry(storyBlock(7), "2026-10-09T00:00:00.000Z"),
      entry(propertyBlock(1), "2026-10-02T00:00:00.000Z"),
      entry(propertyBlock(2), "2026-10-05T00:00:00.000Z"),
      entry(propertyBlock(3), "2026-10-01T00:00:00.000Z", true),
    ]);
    expect(ordered.map((block) => block.id)).toEqual([
      `property:${uuid(3)}`,
      `property:${uuid(2)}`,
      `property:${uuid(1)}`,
      `story:${uuid(7)}`,
    ]);
  });
});
