// W6 item 1: the staff policy follows the weekly Claude allowance, an operator override wins while it holds, and an
// unreadable allowance keeps the last policy, never full power.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { refreshPolicy } from "../../scripts/workforce/config";
import {
  OPUS,
  policyChanged,
  policyFor,
  readingOf,
  SONNET,
  STALE_MS,
  underCeiling,
} from "../../scripts/workforce/usage-policy";

const NOW = new Date("2026-10-15T02:00:00Z");
const RESET = Math.floor(new Date("2026-10-21T16:00:00Z").getTime() / 1000);

function usage(percent: number, updated: Date = NOW, resetsAt: number = RESET) {
  return {
    updated: updated.toISOString(),
    seven_day: { used_percentage: percent, resets_at: resetsAt },
  };
}

const at = (percent: number) => policyFor(readingOf(usage(percent), NOW), {}, null);

describe("the staff policy from the weekly allowance", () => {
  it("gives full staff under 70%", () => {
    expect(at(69)).toMatchObject({
      matterModel: OPUS,
      backlog: "all",
      personOnly: false,
      colleagueCeiling: "opus",
    });
  });

  it("moves to Sonnet and a person's work from 70 to 90%", () => {
    for (const percent of [70, 90]) {
      expect(at(percent)).toMatchObject({
        matterModel: SONNET,
        backlog: "person",
        personOnly: false,
        colleagueCeiling: "sonnet",
      });
    }
  });

  it("answers only a person's lines over 90%", () => {
    expect(at(91)).toMatchObject({
      matterModel: SONNET,
      backlog: "off",
      personOnly: true,
      colleagueCeiling: "sonnet",
    });
    expect(at(94).reason).toBe(
      "Weekly allowance at 94%: backlog paused, only a person's lines are answered.",
    );
  });

  it("lets an override's fields win over the allowance", () => {
    const policy = policyFor(
      readingOf(usage(95), NOW),
      { matterModel: OPUS, backlog: "all" },
      null,
    );
    expect(policy).toMatchObject({ matterModel: OPUS, backlog: "all", personOnly: true });
  });

  it("keeps the last policy when the allowance is unreadable, and never falls back to full power", () => {
    const last = at(95);
    expect(policyFor(null, {}, last)).toEqual(last);
    expect(policyFor(null, {}, null)).toMatchObject({
      matterModel: SONNET,
      backlog: "person",
      week: null,
    });
  });

  it("reads nothing from a missing, stale or already-reset week", () => {
    expect(readingOf(null, NOW)).toBeNull();
    expect(readingOf({ updated: NOW.toISOString() }, NOW)).toBeNull();
    expect(readingOf(usage(10, new Date(NOW.getTime() - STALE_MS - 1)), NOW)).toBeNull();
    expect(readingOf(usage(10, NOW, Math.floor(NOW.getTime() / 1000) - 60), NOW)).toBeNull();
    expect(readingOf(usage(10.4), NOW)).toEqual({
      weekPercent: 10,
      resetsAt: new Date(RESET * 1000),
    });
  });

  it("counts a change only in what the staff may do, and holds an Opus colleague to a Sonnet ceiling", () => {
    expect(policyChanged(at(10), at(60))).toBe(false);
    expect(policyChanged(at(60), at(75))).toBe(true);
    expect([
      underCeiling("opus", "sonnet"),
      underCeiling("opus", "opus"),
      underCeiling("haiku", "sonnet"),
    ]).toEqual(["sonnet", "opus", "haiku"]);
  });

  it("writes the policy each pass and says when it changed, after an account switch too", () => {
    const dir = mkdtempSync(join(tmpdir(), "mop-policy-"));
    const files = {
      usage: join(dir, "usage.json"),
      config: join(dir, "config.json"),
      policy: join(dir, "policy.json"),
    };
    writeFileSync(files.usage, JSON.stringify(usage(94)));
    const first = refreshPolicy(files, NOW);
    const again = refreshPolicy(files, NOW);
    // `/login` to another account: the status line writes the new account's numbers.
    writeFileSync(files.usage, JSON.stringify(usage(1)));
    const switched = refreshPolicy(files, NOW);
    writeFileSync(files.usage, "not json");
    const unreadable = refreshPolicy(files, NOW);
    expect([first.changed, again.changed, switched.changed, unreadable.changed]).toEqual([
      true,
      false,
      true,
      false,
    ]);
    expect(unreadable).toMatchObject({ unreadable: true, policy: { matterModel: OPUS, week: 1 } });
    expect(JSON.parse(readFileSync(files.policy, "utf8"))).toMatchObject({
      backlog: "all",
      week: 1,
    });
  });
});
