// W7 E3: the signature move, the emblem as a door (launch/engine/moves/door.mjs), its place in every requested reel's
// brief, and the review sheet that shows a reel's last frame.
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CLOSE_S,
  LOCKUP,
  OPEN_S,
  clipNear,
  closeState,
  doorCues,
  lens,
  mix,
  openState,
} from "../../../../launch/engine/moves/door.mjs";
import {
  COPY_RULE,
  DOOR_RULE,
  REFERENCE,
  type Brief,
  scenePrompt,
  sheetFilter,
} from "../../../scripts/workforce/reel.ts";

const brief: Brief = {
  id: "b1",
  at: "2026-10-15T12:00:00Z",
  request: { skill: "reel", name: "Not every home", kind: "brand", titles: ["Not every home"] },
  from: { agent: "matter", thread: "team" },
  state: "queued",
};

describe("W7 E3: the emblem as a door", () => {
  it("opens in five beats into light, and settles the lockup by 2.5 s of a 3.25 s close", () => {
    expect(OPEN_S).toBe(3.75);
    expect(CLOSE_S).toBe(3.25);
    expect([openState(0).D, openState(1.6).D]).toEqual([0, 1]);
    expect(openState(OPEN_S).wash).toBeCloseTo(1, 2);
    expect([closeState(-0.3).wash, closeState(0).wash]).toEqual([0, 1]);
    const settled = closeState(2.5);
    expect([settled.D, settled.lit, settled.mark, settled.rule, settled.url]).toEqual([
      0, 1, 1, 1, 1,
    ]);
    expect(Array.from({ length: 13 }, (_, i) => settled.letter(i))).toEqual(Array(13).fill(1));
    expect(settled.spread).toBe(1);
  });

  it("lands the door's 3D mark where the vector mark is drawn, and keeps the lockup in the safe area", () => {
    for (const v of [1.2, 1.8, 2.4, 3.2]) {
      const st = closeState(v);
      const L = lens(st.cam, 1080, 1920);
      const top = L.toScreen(L.toCam([0, 13, 0.6])),
        foot = L.toScreen(L.toCam([0, 0, 0.6]));
      expect(Math.abs(top[1] - (LOCKUP.markCY - (st.k * LOCKUP.markH) / 2))).toBeLessThan(2);
      expect(Math.abs(foot[1] - (LOCKUP.markCY + (st.k * LOCKUP.markH) / 2))).toBeLessThan(2);
      expect(top[0]).toBeCloseTo(540 + st.dx, 3);
    }
    // from the moment the name starts, the mark leaves it room and the address stays above the safe line
    const first = closeState(1.5),
      words = 1 + (first.k - 1) * 0.5;
    expect(LOCKUP.markCY + (first.k * LOCKUP.markH) / 2).toBeLessThan(
      LOCKUP.markCY + (LOCKUP.wordTop - LOCKUP.markCY) * words,
    );
    expect(LOCKUP.markCY + (LOCKUP.urlBase - LOCKUP.markCY) * words).toBeLessThanOrEqual(1250);
    expect(LOCKUP.markCY - LOCKUP.markH / 2).toBeGreaterThanOrEqual(270);
    expect(LOCKUP.urlSize).toBeGreaterThanOrEqual(32);
  });

  it("never holds a still lockup: it travels sideways at a steady pace once settled", () => {
    const pace = (closeState(3.0).dx - closeState(2.5).dx) / 0.5;
    expect(pace).toBeCloseTo(-32, 5);
    expect(closeState(1.5).dx).toBe(0);
  });

  it("clips at the lens, so a floor that runs behind the camera never folds over the picture", () => {
    const kept = clipNear([
      [0, 0, 10],
      [1, 0, 10],
      [1, 0, -10],
      [0, 0, -10],
    ]);
    expect(kept.every(([, , z]) => z >= 0.05)).toBe(true);
    expect(kept).toHaveLength(4);
  });

  it("mixes colours that mix again (the planes once fell back to Obsidian)", () => {
    expect(mix(mix("#11110F", "#D8D4CC", 0.13), "#D8D4CC", 0.5)).toMatch(/^#[0-9a-f]{6}$/);
    expect(mix("#000000", "#FFFFFF", 0.5)).toBe("#808080");
  });
});

describe("W7 E3: every requested reel ends on the door", () => {
  it("puts the move in the designer's brief, with its sound at the move's own times", () => {
    const prompt = scenePrompt(brief, []);
    expect(prompt).toContain(DOOR_RULE);
    expect(COPY_RULE).toContain("the lockup the door move draws");
    expect(DOOR_RULE).toContain(`close: duration - ${String(CLOSE_S)}`);
    const said = (cue: { type: string; t: number }) =>
      `${cue.type} at ${cue.t >= 0 ? "+" : ""}${String(cue.t)} s`;
    for (const cue of [...doorCues({ close: 0 }), ...doorCues({ open: 0 })]) {
      expect(DOOR_RULE).toContain(said(cue));
      expect(DOOR_RULE).toContain(`${String(cue.db)} dB`);
    }
  });

  it("copies the move and the study into the studio for the designer to read", () => {
    expect(REFERENCE).toContain("launch/engine/moves/door.mjs");
    expect(REFERENCE).toContain("launch/STUDY.md");
    for (const rel of REFERENCE)
      expect(existsSync(new URL(`../../../../${rel}`, import.meta.url))).toBe(true);
  });

  it("shows the reviewer the film's last frame, where the lockup is", () => {
    expect(sheetFilter(600)).toContain("eq(n\\,599)");
    expect(sheetFilter(600)).toContain("lt(n\\,525)*not(mod(n\\,75))");
  });
});
