// Diagnostics that mirror launch/tools/motion-gate.mjs, with timecodes, so a failing check points at a shot.
// Usage: node launch/engine/probe.mjs motion <file.mp4>      static runs >= 0.5 s, per-second motion coverage
//        node launch/engine/probe.mjs flat <file.wav|mp4>    1.5 s windows under flatness 0.15 (AAC-encodes a wav first)
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [mode, file] = process.argv.slice(2);
const run = (args) => spawnSync("ffmpeg", args, { encoding: "utf8", maxBuffer: 1 << 28 });

if (mode === "motion") {
  const r = run(["-v", "error", "-i", file, "-vf", "scale=480:-2,tblend=all_mode=difference,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-", "-f", "null", "-"]);
  const y = [...r.stdout.matchAll(/YAVG=([\d.]+)/g)].map((m) => Number(m[1])).slice(1);
  const T = 0.35, fps = 30;
  let start = -1;
  const runs = [];
  y.forEach((v, i) => { if (v <= T) { if (start < 0) start = i; } else if (start >= 0) { runs.push([start, i]); start = -1; } });
  if (start >= 0) runs.push([start, y.length]);
  console.log(`frames ${y.length}, moving ${(100 * y.filter((v) => v > T).length / y.length).toFixed(1)}%`);
  for (const [a, b] of runs) if (b - a >= 15) console.log(`static ${((a + 1) / fps).toFixed(2)}-${((b + 1) / fps).toFixed(2)}s (${((b - a) / fps).toFixed(2)}s)`);
  const sec = [];
  for (let s = 0; s * fps < y.length; s++) { const w = y.slice(s * fps, (s + 1) * fps); sec.push(`${s}:${Math.round((100 * w.filter((v) => v > T).length) / w.length)}`); }
  console.log("per-second % moving: " + sec.join(" "));
} else if (mode === "flat") {
  let src = file;
  if (file.endsWith(".wav")) { src = join(tmpdir(), "mop-flat.m4a"); run(["-v", "error", "-y", "-i", file, "-c:a", "aac", "-b:a", "192k", src]); }
  const d = Number(spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", src], { encoding: "utf8" }).stdout);
  const r = run(["-v", "error", "-i", src, "-af", "aspectralstats=measure=flatness:win_size=4096,ametadata=print:key=lavfi.aspectralstats.1.flatness:file=-", "-f", "null", "-"]);
  const f = [...r.stdout.matchAll(/flatness=([\d.]+)/g)].map((m) => Number(m[1]));
  const per = f.length / d, win = Math.max(1, Math.round(per * 1.5));
  let worst = 1, bad = [];
  for (let i = 0; i + win <= f.length; i += Math.max(1, win >> 2)) {
    const m = f.slice(i, i + win).reduce((a, b) => a + b, 0) / win;
    if (m < worst) worst = m;
    if (m < 0.15) bad.push(`${(i / per).toFixed(1)}s:${m.toFixed(3)}`);
  }
  console.log(`min flatness ${worst.toFixed(3)} (gate >= 0.15); windows under: ${bad.length}`);
  if (bad.length) console.log(bad.join(" "));
}
