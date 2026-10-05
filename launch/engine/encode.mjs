// Encode frames + sound into the film, and build the contact sheet.
// Usage: node launch/engine/encode.mjs <dir> [--name out.mp4] [--audio-only] [--maxrate <kbps>]   (expects <dir>/frames/%05d.png and <dir>/audio.wav)
//
// Loudness is set in two explicit passes instead of single-pass `loudnorm` in the mux: single-pass loudnorm is
// dynamic (it compresses toward LRA and lifts quiet passages), which would pump the silence beats up. Here the whole
// mix gets ONE linear gain to -18 LUFS integrated, then a limiter holds true peak under -1 dBTP.
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const dir = resolve(args[0]);
const i = args.indexOf("--name");
const name = i >= 0 ? args[i + 1] : "film.mp4";
const rate = args.indexOf("--maxrate");
const maxrate = rate >= 0 ? Number(args[rate + 1]) : 0;
const run = (a) => { const r = spawnSync("ffmpeg", a, { encoding: "utf8", maxBuffer: 1 << 28 }); if (r.status) { console.error(r.stderr); process.exit(1); } return r; };
const measure = (f) => JSON.parse(run(["-v", "info", "-i", f, "-af", "loudnorm=I=-18:TP=-1:print_format=json", "-f", "null", "-"]).stderr.match(/\{[\s\S]*\}/)[0]);

const wav = join(dir, "audio.wav"), norm = join(dir, "audio-norm.wav");
const m = measure(wav);
let gain = -18 - Number(m.input_i);
for (let pass = 0; pass < 3; pass++) {
  run(["-v", "error", "-y", "-i", wav, "-af", `volume=${gain.toFixed(2)}dB,alimiter=limit=0.79:attack=2:release=60:level=disabled`, "-c:a", "pcm_f32le", norm]);
  const n = measure(norm);
  console.log(`loudness pass ${pass}: gain ${gain.toFixed(2)} dB -> ${n.input_i} LUFS, ${n.input_tp} dBTP`);
  if (Math.abs(Number(n.input_i) + 18) <= 0.3) break;
  gain += -18 - Number(n.input_i);
}

if (args.includes("--audio-only")) process.exit(0);

const out = join(dir, name);
const frames = readdirSync(join(dir, "frames")).filter((f) => f.endsWith(".png")).length;
run(["-v", "error", "-y", "-framerate", "30", "-i", join(dir, "frames", "%05d.png"), "-i", norm, "-c:v", "libx264", "-crf", "18", ...(maxrate ? ["-maxrate", `${maxrate}k`, "-bufsize", `${2 * maxrate}k`] : []), "-preset", "slow",
  "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-shortest", out]);
const rows = Math.ceil(frames / 30 / 2 / 8);
run(["-v", "error", "-y", "-i", out, "-vf", `fps=1/2,scale=320:-1,tile=8x${rows}`, "-frames:v", "1", join(dir, "contact-sheet.png")]);
console.log(`encoded ${frames} frames -> ${out}\ncontact sheet -> ${join(dir, "contact-sheet.png")}`);
