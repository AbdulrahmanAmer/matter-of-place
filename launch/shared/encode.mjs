// Encode <sceneDir>/frames/%05d.png to an H.264 MP4 and a contact sheet (one still every 3 s).
// Usage: node shared/encode.mjs <sceneDir> <out.mp4> [--crf 18]
import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

const args = process.argv.slice(2);
const sceneDir = resolve(args[0]);
const out = join(sceneDir, args[1]);
const crfIdx = args.indexOf("--crf");
const crf = crfIdx >= 0 ? args[crfIdx + 1] : "18";
const frames = join(sceneDir, "frames/%05d.png");
const count = readdirSync(join(sceneDir, "frames")).filter((f) => f.endsWith(".png")).length;

const run = (a) => execFileSync("ffmpeg", ["-y", "-v", "error", ...a], { stdio: "inherit" });

run(["-framerate", "30", "-i", frames, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", crf, "-movflags", "+faststart", out]);

const rows = Math.ceil(Math.ceil(count / 90) / 6);
run(["-i", out, "-vf", `fps=1/3,scale=320:-1,tile=6x${rows}`, "-frames:v", "1", join(sceneDir, "contact-sheet.png")]);

console.log(`${out}  ${(statSync(out).size / 1e6).toFixed(1)} MB  (crf ${crf}, ${count} frames)`);
console.log(join(sceneDir, "contact-sheet.png"));
