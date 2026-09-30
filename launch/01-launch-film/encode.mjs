// ffmpeg -framerate 30 -i frames/%05d.png -c:v libx264 -pix_fmt yuv420p -crf 18 -movflags +faststart matter-of-place-launch.mp4
// plus contact-sheet.png (fps=1/3, scale=320:-1, tile=6xN). Pass --crf 22 if the file exceeds 80 MB.
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
execFileSync("node", [join(here, "../shared/encode.mjs"), here, "matter-of-place-launch.mp4", ...process.argv.slice(2)], { stdio: "inherit" });
