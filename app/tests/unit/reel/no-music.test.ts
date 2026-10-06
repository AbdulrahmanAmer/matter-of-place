// B12 step 3, S36: no music, ever. The sound engine and the reel hold noise, filters and envelopes, never a tone.
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ROOT = new URL("../../../../", import.meta.url);
const TONE = /createOscillator|OscillatorNode|\bTone\.|from ["']tone["']|require\(["']tone["']\)/;

function reelFiles(): string[] {
  return readdirSync(new URL("launch/reel/", ROOT)).filter((name) =>
    /\.(?:m?js|html|json)$/.test(name),
  );
}

describe("no music", () => {
  it("keeps oscillators out of the sound engine", () => {
    const engine = readFileSync(new URL("launch/engine/runtime/audio.js", ROOT), "utf8");
    expect(engine).toContain("renderCues");
    expect(engine).not.toMatch(TONE);
  });

  it("keeps oscillators and Tone out of every file of the reel", () => {
    const names = reelFiles();
    expect(names).toEqual(expect.arrayContaining(["cues.mjs", "scene.mjs", "scene.html"]));
    const offending = names.filter((name) =>
      TONE.test(readFileSync(new URL(`launch/reel/${name}`, ROOT), "utf8")),
    );
    expect(offending).toEqual([]);
  });
});
