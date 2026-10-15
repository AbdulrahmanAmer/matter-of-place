// The door move's own sound, alone: an air floor and room tone under the move's cues (noise only, S36).
//   node launch/engine/moves/demo/cues.mjs <out.json>
import { writeFileSync } from "node:fs";
import { CLOSE_S, OPEN_S, doorCues } from "../door.mjs";

export function buildCues() {
  const duration = OPEN_S + CLOSE_S;
  return {
    duration,
    sampleRate: 48000,
    cues: [
      {
        t: 0,
        end: duration,
        type: "air",
        db: -40,
        fadeIn: 0.05,
        fadeOut: 0.3,
        seed: 20,
        label: "air floor",
      },
      {
        t: 0,
        end: duration,
        type: "room",
        db: -25,
        fadeIn: 0.6,
        fadeOut: 0.6,
        label: "room tone",
      },
      ...doorCues({ open: 0, close: OPEN_S }),
    ],
  };
}

if (process.argv[2])
  writeFileSync(process.argv[2], JSON.stringify(buildCues(), null, 2));
