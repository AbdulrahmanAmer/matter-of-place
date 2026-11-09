// The Chrome a laptop or CI script drives: shared by the render scripts (shoot.mjs) and Matter's admin browser.
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";

const engineSchema = z.object({ findChrome: z.function().returns(z.string()) });

/** @returns {Promise<string>} Chrome from `CHROME_PATH`, else the cached one `findChrome()` returns on the laptop */
export async function chromePath() {
  const fromEnv = process.env["CHROME_PATH"];
  if (fromEnv !== undefined && fromEnv !== "") return fromEnv;
  const enginePath = fileURLToPath(new URL("../../../launch/engine/chrome.mjs", import.meta.url));
  const engine = engineSchema.parse(
    await import(/* @vite-ignore */ pathToFileURL(enginePath).href),
  );
  return engine.findChrome();
}
