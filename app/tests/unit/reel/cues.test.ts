// B12 step 3: the sound design of the reel is a cue list built by rule from the spec (MOTION-BIBLE section 3).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildCues } from "../../../../launch/reel/cues.mjs";
import fixture from "../../../../launch/reel/fixture-spec.json";

const read = (path: string) =>
  readFileSync(new URL(`../../../../${path}`, import.meta.url), "utf8");
const withBed = (bed: string, seed = fixture.sound.seed) => ({ sound: { bed, seed } });

describe("buildCues", () => {
  it("gives the same cue list for the same spec", () => {
    expect(JSON.stringify(buildCues(fixture))).toBe(JSON.stringify(buildCues(fixture)));
  });

  it("changes the bed phase with the seed", () => {
    const phases = (seed: number) =>
      buildCues(withBed("wind", seed)).cues.flatMap((cue) =>
        cue.type === "wind" ? [cue["seed"]] : [],
      );
    expect(phases(1)).not.toEqual(phases(2));
  });

  it("holds no oscillator or Tone call in the code or the cues", () => {
    const text = `${read("launch/reel/cues.mjs")}${JSON.stringify(buildCues(fixture))}`;
    expect(text).not.toMatch(/createOscillator|OscillatorNode|\bTone\.|from ["']tone["']/);
  });

  it("uses only cue types the sound engine implements", () => {
    const engine = new Set(
      [...read("launch/engine/runtime/audio.js").matchAll(/case "(\w+)":/g)].map((m) => m[1]),
    );
    expect(engine.size).toBeGreaterThan(8);
    const used = new Set(buildCues(fixture).cues.map((cue) => cue.type));
    expect([...used].filter((type) => !engine.has(type))).toEqual([]);
  });

  it("keeps two silence beats where only the air floor sounds", () => {
    const { cues } = buildCues(fixture);
    const quiet = cues.filter((cue) => cue.type === "air" && cue.db <= -55);
    expect(quiet).toHaveLength(2);
    for (const floor of quiet) {
      const from = floor.t + 0.05;
      const to = (floor.end ?? 0) - 0.05;
      const sounding = cues.filter(
        (cue) => cue.type !== "air" && cue.t < to && (cue.end ?? cue.t + (cue.dur ?? 0.5)) > from,
      );
      expect(sounding.map((cue) => cue.label)).toEqual([]);
    }
  });

  it("never lets the air floor fall to digital silence", () => {
    const floor = buildCues(fixture).cues.filter((cue) => cue.type === "air");
    expect(Math.min(...floor.map((cue) => cue.t))).toBe(0);
    expect(Math.max(...floor.map((cue) => cue.end ?? 0))).toBe(18);
    expect(floor.every((cue) => cue.db >= -60)).toBe(true);
  });

  it.each(["wind", "water", "room", "city"])("plays the %s bed and no other", (bed) => {
    const types = new Set(buildCues(withBed(bed)).cues.map((cue) => cue.type));
    for (const other of ["wind", "water", "city"]) {
      expect(types.has(other)).toBe(other === bed);
    }
    expect(types.has("room")).toBe(true);
  });

  it("puts the stone step in interiors only", () => {
    const steps = (bed: string) =>
      buildCues(withBed(bed)).cues.filter((cue) => cue.type === "step").length;
    expect([steps("wind"), steps("water"), steps("room"), steps("city")]).toEqual([0, 0, 1, 1]);
  });

  it("ends the reel on the lock: one impact, nothing after 18 s", () => {
    const { duration, cues } = buildCues(fixture);
    expect(duration).toBe(18);
    expect(cues.filter((cue) => cue.type === "impact").map((cue) => cue.t)).toEqual([16.75]);
    expect(cues.every((cue) => cue.t >= 0 && (cue.end ?? cue.t) <= 18)).toBe(true);
  });
});
