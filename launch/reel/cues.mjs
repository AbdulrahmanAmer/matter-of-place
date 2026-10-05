// Sound design of the reel as a cue list for engine/runtime/audio.js (MOTION-BIBLE §3: noise, filters and envelopes,
// no music). Timings follow STORYBOARD.md on the same clock as scene.mjs; the bed comes from the spec's sound block.
//   node launch/reel/cues.mjs <spec.json> <out.json>
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DURATION = 18;

/**
 * @typedef {{ t: number, type: string, db: number, end?: number, dur?: number, label: string, [param: string]: unknown }} Cue
 * @param {{ sound: { bed: string, seed: number } }} spec
 * @returns {{ duration: number, sampleRate: number, cues: Cue[] }}
 */
export function buildCues(spec) {
  const { bed, seed } = spec.sound;
  const phase = (seed % 997) + 1;
  const interior = bed === "room" || bed === "city";
  /** @type {Cue[]} */
  const cues = [];

  // The air floor never drops to digital silence (P-024); in the two silence beats it is the only sound.
  const floor = [
    [0, 11.25, -43, 0, 0.05, 20, "air floor"],
    [11.2, 11.75, -58, 0.05, 0.05, 21, "silence beat after the cut to black"],
    [11.7, 17.35, -43, 0.05, 0.05, 22, "air floor"],
    [17.3, DURATION, -58, 0.05, 0, 23, "silence beat after the lock"],
  ];
  for (const [t, end, db, fadeIn, fadeOut, s, label] of floor) {
    cues.push({ t, end, type: "air", db, fadeIn, fadeOut, seed: s, label });
  }

  // Room tone under everything except the silence beats; it goes out after the lock.
  cues.push({ t: 0, end: 11.2, type: "room", db: -20, fadeIn: 1, fadeOut: 0.1, label: "room tone" });
  cues.push({ t: 11.7, end: 17.3, type: "room", db: -20, fadeIn: 0.4, fadeOut: 0.5, label: "room tone returns, then out after the lock" });

  const beds = {
    wind: [
      { db: -22.5, lfo: 0.11, lfoDepth: 4, rustle: 8 },
      { db: -22, lfo: 0.17, lo: 250, hi: 900 },
    ],
    water: [{ db: -17, swell: 7 }, { db: -19, swell: 6 }],
    city: [{ db: -15 }, { db: -16 }],
    room: [],
  };
  const [first, second] = beds[bed];
  if (first && second) {
    cues.push({ t: 0, end: 11.2, type: bed, fadeIn: 1.4, fadeOut: 0.1, seed: phase, ...(bed === "wind" ? { gusts: [7.0] } : {}), ...first, label: `${bed} bed` });
    cues.push({ t: 11.7, end: 16.8, type: bed, fadeIn: 0.8, fadeOut: 0.4, seed: phase + 1, ...second, label: `${bed} bed returns` });
  }

  const shots = [
    [2.9, "whoosh", -16, { dur: 0.2 }, "M9 split, photograph 1 to 2"],
    [6.9, "whoosh", -16, { dur: 0.2 }, "M9 split, photograph 2 to 3"],
    [8.2, "paper", -20, { dur: 0.6 }, "the facts row arrives"],
    [10.95, "whoosh", -14, { dur: 0.2 }, "M13 cut to black"],
    [11.7, "fabric", -19, { dur: 0.6 }, "M10 the tiles assemble"],
    [12.65, "whoosh", -17, { dur: 0.5, pan: 0 }, "one tile grows to the frame"],
    [14.6, "whoosh", -17, { dur: 0.25, pan: [0.5, -0.5] }, "M9 split to the last photograph"],
    [16.75, "impact", -6, {}, "the wordmark locks"],
    ...(interior ? [[3.85, "step", -12, { pan: 0.1 }, "one stone step in the interior"]] : []),
  ];
  for (const [t, type, db, extra, label] of shots) cues.push({ t, type, db, ...extra, label });

  cues.sort((a, b) => a.t - b.t || a.type.localeCompare(b.type));
  return { duration: DURATION, sampleRate: 48000, cues };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const [specPath, outPath] = process.argv.slice(2);
  if (!specPath || !outPath) {
    console.error("usage: node launch/reel/cues.mjs <spec.json> <out.json>");
    process.exit(64);
  }
  mkdirSync(dirname(resolve(outPath)), { recursive: true });
  writeFileSync(outPath, JSON.stringify(buildCues(JSON.parse(readFileSync(specPath, "utf8"))), null, 1) + "\n");
  console.log(`cues ${outPath}`);
}
