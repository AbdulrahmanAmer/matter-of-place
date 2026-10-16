// Draws an admin screen's real components with the real admin stylesheet in Chrome at three widths, writes a PNG of each
// and fails when anything leaves its card or a card crosses another (W8 item 11: the Visuals captions ran into the next
// card). Run from `app/` with bun:
//   bun scripts/admin-shot.ts visuals|proposed [--out .tmp/shots/out]
// The scenes are `tests/fixtures/admin-scenes.tsx` (React, so it is loaded by path: this file is checked without the DOM
// library). Bun renders the markup, node drives Chrome (`admin-shot-measure.mjs`, P-3601). It makes the pictures and the
// film it draws under `.tmp/shots` with ffmpeg and reaches no network and no database.
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";

const ROOT = resolve(import.meta.dirname, "..");
const SHOTS = join(ROOT, ".tmp", "shots");
const DEFAULT_OUT = ".tmp/shots/out";

const scene = z.object({ body: z.string(), card: z.string(), cell: z.string() });
const sceneModule = z.object({
  renderScene: z.custom<(name: string) => unknown>((value) => typeof value === "function"),
});

/** The fixtures the scenes draw: solid pictures at the real sizes and a one-second film, from ffmpeg. */
function makeMedia(): void {
  const make = (args: string[]) => {
    const run = spawnSync("ffmpeg", ["-y", "-loglevel", "error", ...args], { stdio: "inherit" });
    if (run.status !== 0) throw new Error(`ffmpeg ${args.join(" ")} failed`);
  };
  const still = (name: string, colour: string, size: string) => {
    make([
      "-f",
      "lavfi",
      "-i",
      `color=c=${colour}:s=${size}:d=1`,
      "-frames:v",
      "1",
      join(SHOTS, name),
    ]);
  };
  still("cover.jpg", "0xF5F2EB", "1200x630");
  still("slide.jpg", "0xEEEAE1", "1080x1350");
  still("poster.jpg", "0xC9C0B2", "1080x1920");
  make([
    "-f",
    "lavfi",
    "-i",
    "color=c=0x575751:s=1080x1920:d=1:r=10",
    "-pix_fmt",
    "yuv420p",
    join(SHOTS, "reel.mp4"),
  ]);
}

async function main(): Promise<void> {
  const name = process.argv[2] ?? "";
  const outFlag = process.argv.indexOf("--out");
  const out = outFlag > 0 ? (process.argv[outFlag + 1] ?? DEFAULT_OUT) : DEFAULT_OUT;
  mkdirSync(SHOTS, { recursive: true });
  mkdirSync(join(ROOT, out), { recursive: true });
  makeMedia();

  const scenes = sceneModule.parse(
    await import(pathToFileURL(join(ROOT, "tests", "fixtures", "admin-scenes.tsx")).href),
  );
  const drawn = scene.parse(scenes.renderScene(name));
  const css = pathToFileURL(join(ROOT, "src", "styles", "admin", "index.css")).href;
  writeFileSync(
    join(SHOTS, `${name}.html`),
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="${css}"></head><body><main class="admin-main" style="padding:16px">${drawn.body}</main></body></html>`,
  );
  const run = spawnSync(
    "node",
    [join(ROOT, "scripts", "admin-shot-measure.mjs"), name, drawn.card, drawn.cell, out],
    { cwd: ROOT, stdio: "inherit" },
  );
  process.exitCode = run.status ?? 1;
}

await main();
