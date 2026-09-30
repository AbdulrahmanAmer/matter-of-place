// Tile stills into one labelled review sheet (the ffmpeg build here has no glob input).
// Usage: node launch/engine/sheet.mjs <out.jpg> <cols> <width> <img...>
import { spawnSync } from "node:child_process";
import { basename } from "node:path";

const [out, colsArg, widthArg, ...files] = process.argv.slice(2);
const cols = Number(colsArg), w = Number(widthArg), h = Math.round((w * 9) / 16);
const inputs = files.flatMap((f) => ["-i", f]);
const font = "C\\:/Windows/Fonts/arial.ttf";
const chains = files.map((f, i) => `[${i}]scale=${w}:${h},drawtext=fontfile='${font}':text='${basename(f, ".png").replace(/[:']/g, "")}':x=8:y=8:fontsize=${Math.max(12, w / 22)}:fontcolor=white:box=1:boxcolor=black@0.6[v${i}]`);
const layout = files.map((_, i) => `${(i % cols) * w}_${Math.floor(i / cols) * h}`).join("|");
const graph = files.length === 1 ? `${chains[0]};[v0]null` : `${chains.join(";")};${files.map((_, i) => `[v${i}]`).join("")}xstack=inputs=${files.length}:layout=${layout}:fill=black`;
const r = spawnSync("ffmpeg", ["-v", "error", "-y", ...inputs, "-filter_complex", graph, "-frames:v", "1", "-q:v", "3", out], { encoding: "utf8" });
if (r.status) { console.error(r.stderr); process.exit(1); }
console.log(out);
