// Partner presentation: refresh exposure data from the codebase, then capture every frame.
// Usage: node render.mjs [--only 0,300,...] [--workers 4]
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
execFileSync("bun", [join(here, "../shared/extract-exposure.mjs")], { stdio: "inherit" });
execFileSync("node", [join(here, "../shared/render.mjs"), here, ...process.argv.slice(2)], { stdio: "inherit" });
