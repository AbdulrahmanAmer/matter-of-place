// Motion gate for Matter of Place films. Usage: node launch/tools/motion-gate.mjs <file.mp4> [--min-s 60 --max-s 80]
// Measures with ffmpeg/ffprobe only (no model): motion coverage, longest static run, cuts, shot length, loudness,
// pitched-content check, format. Exit 1 on any failed threshold. Zero tokens.
import { spawnSync } from "node:child_process";

const file = process.argv[2];
if (!file) { console.error("usage: motion-gate.mjs <mp4>"); process.exit(2); }
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? Number(process.argv[i + 1]) : d; };
const MIN_S = arg("--min-s", 60), MAX_S = arg("--max-s", 80);

const run = (cmd, args) => spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 1 << 28 });

// 1. format
const probe = run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,r_frame_rate,codec_name:format=duration", "-of", "json", file]);
const meta = JSON.parse(probe.stdout || "{}");
const v = meta.streams?.[0] || {}; const dur = Number(meta.format?.duration || 0);
const fps = v.r_frame_rate ? (([a, b]) => a / b)(v.r_frame_rate.split("/").map(Number)) : 0;

// 2. per-frame luminance difference (tblend difference + signalstats YAVG)
const diff = run("ffmpeg", ["-v", "error", "-i", file, "-vf", "scale=480:-2,tblend=all_mode=difference,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-", "-f", "null", "-"]);
const yavg = [...(diff.stdout || "").matchAll(/YAVG=([\d.]+)/g)].map((m) => Number(m[1])).slice(1);
const THRESH = 0.35; // mean abs luma diff on 0..255 scale; ~1 to 2 % drift per shot clears this
let moving = 0, longest = 0, cur = 0;
for (const y of yavg) { if (y > THRESH) { moving++; cur = 0; } else { cur++; if (cur > longest) longest = cur; } }
const coverage = yavg.length ? (moving / yavg.length) * 100 : 0;
const longestS = fps ? longest / fps : 0;

// 3. cuts
const cutsRun = run("ffmpeg", ["-v", "error", "-i", file, "-vf", "scale=480:-2,select='gt(scene,0.30)',metadata=print:file=-", "-f", "null", "-"]);
const cuts = (cutsRun.stdout.match(/pts_time/g) || []).length;
const avgShot = dur / (cuts + 1);

// 4. loudness (if audio present)
const hasAudio = run("ffprobe", ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=codec_name", "-of", "csv=p=0", file]).stdout.trim() !== "";
let lufs = null, tp = null, pitched = null;
if (hasAudio) {
  const ln = run("ffmpeg", ["-v", "info", "-i", file, "-af", "loudnorm=print_format=json", "-f", "null", "-"]);
  const j = ln.stderr.match(/\{[\s\S]*\}/); if (j) { const o = JSON.parse(j[0]); lufs = Number(o.input_i); tp = Number(o.input_tp); }
  // pitched-content check: dominant frequency per 100 ms window via astats is not available; approximate with
  // 'aspectralstats' mean centroid variance is noisy, so use the simplest robust proxy: a 1.5 s stable dominant
  // peak shows up as low spectral flatness. Fail if average flatness < 0.15 over any 1.5 s.
  const sf = run("ffmpeg", ["-v", "error", "-i", file, "-af", "aspectralstats=measure=flatness:win_size=4096,ametadata=print:key=lavfi.aspectralstats.1.flatness:file=-", "-f", "null", "-"]);
  const flat = [...(sf.stdout || "").matchAll(/flatness=([\d.]+)/g)].map((m) => Number(m[1]));
  const win = Math.max(1, Math.round(flat.length / Math.max(1, dur) * 1.5));
  let worst = 1; for (let i = 0; i + win <= flat.length; i += Math.max(1, win >> 2)) { const m = flat.slice(i, i + win).reduce((a, b) => a + b, 0) / win; if (m < worst) worst = m; }
  pitched = worst;
}

const checks = [
  ["format 1920x1080", v.width === 1920 && v.height === 1080, `${v.width}x${v.height}`],
  ["30 fps h264", Math.round(fps) === 30 && v.codec_name === "h264", `${fps.toFixed(2)} ${v.codec_name}`],
  [`duration ${MIN_S}-${MAX_S}s`, dur >= MIN_S && dur <= MAX_S, `${dur.toFixed(1)}s`],
  ["motion coverage >= 85%", coverage >= 85, `${coverage.toFixed(1)}%`],
  ["longest static run <= 1.0s", longestS <= 1.0, `${longestS.toFixed(2)}s`],
  ["cuts 12-30", cuts >= 12 && cuts <= 30, `${cuts}`],
  ["avg shot 2.0-5.5s", avgShot >= 2.0 && avgShot <= 5.5, `${avgShot.toFixed(2)}s`],
  ["audio present", hasAudio, hasAudio ? "yes" : "no"],
  ["loudness -18 +/-1.5 LUFS", lufs !== null && Math.abs(lufs + 18) <= 1.5, lufs === null ? "n/a" : `${lufs} LUFS`],
  ["true peak <= -1 dBTP", tp !== null && tp <= -1, tp === null ? "n/a" : `${tp} dBTP`],
  ["no sustained pitch (min flatness >= 0.15)", pitched !== null && pitched >= 0.15, pitched === null ? "n/a" : pitched.toFixed(3)],
];
let fail = 0;
for (const [name, ok, val] of checks) { console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(42)} ${val}`); if (!ok) fail++; }
console.log(fail ? `GATE FAILED (${fail})` : "GATE PASSED");
process.exit(fail ? 1 : 0);
