// A name the harden probes need that `scripts/load-env.mjs --profile dev` does not export: the shell's value, else the
// repository's git-ignored `.env`. The value is returned to the caller and never printed.
import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";

const DOTENV = new URL("../../../.env", import.meta.url);

export function localEnv(name: string): string | undefined {
  const shell = process.env[name];
  if (shell !== undefined && shell !== "") return shell;
  if (!existsSync(DOTENV)) return undefined;
  const value = parseEnv(readFileSync(DOTENV, "utf8").replaceAll("\r", ""))[name];
  return value === undefined || value === "" ? undefined : value;
}
