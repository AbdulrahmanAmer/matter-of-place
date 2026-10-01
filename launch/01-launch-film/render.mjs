// Launch film: decode the waterline footage to stills, then capture every frame.
// Usage: node render.mjs [--only 0,300,...] [--workers 4]
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const cache = join(here, "media-cache/tiburon");
if (!existsSync(join(cache, "144.jpg"))) {
  mkdirSync(cache, { recursive: true });
  execFileSync("ffmpeg", ["-y", "-v", "error", "-i", join(here, "../../app/public/media/tiburon-waterline.mp4"),
    "-vf", "scale=1920:1080:flags=lanczos", "-q:v", "2", join(cache, "%03d.jpg")], { stdio: "inherit" });
}
execFileSync("node", [join(here, "../shared/render.mjs"), here, ...process.argv.slice(2)], { stdio: "inherit" });
