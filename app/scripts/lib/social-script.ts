// What the social scripts of B10 share: where a secret comes from, the one database target (ruling H35) and the
// exit code of a script that failed. A value is never printed.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parseEnv } from "node:util";

const ENV_FILE = new URL("../../../.env", import.meta.url);

/** The value from the shell, else from the repository's git-ignored `.env`; undefined when neither holds it. */
export function readSecret(name: string): string | undefined {
  const fromShell = process.env[name];
  if (fromShell !== undefined && fromShell !== "") return fromShell;
  if (!existsSync(ENV_FILE)) return undefined;
  const value = parseEnv(readFileSync(ENV_FILE, "utf8").replaceAll("\r", ""))[name];
  return value === "" ? undefined : value;
}

export function requireSecret(name: string): string {
  const value = readSecret(name);
  if (value === undefined) throw new Error(`BLOCKED: no ${name} in the shell or .env`);
  return value;
}

/** Sets `name=value` in `.env`, replacing the line when there is one and keeping the file's line endings. */
export function setEnvValue(name: string, value: string): void {
  const text = readFileSync(ENV_FILE, "utf8");
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(eol);
  const at = lines.findIndex((line) => line.startsWith(`${name}=`));
  if (at >= 0) lines[at] = `${name}=${value}`;
  else lines.splice(lines.at(-1) === "" ? -1 : lines.length, 0, `${name}=${value}`);
  writeFileSync(ENV_FILE, lines.join(eol));
}

/** `dev` is the only target: one database, ruling H35. A second project would plug in here. */
export function assertDevTarget(target: string | undefined): void {
  if (target !== undefined && target !== "dev") throw new Error("refusing: one database (H35)");
}

/** Runs a script's `main`, prints a thrown error's message and turns it into exit code 1. */
export async function runScript(main: () => Promise<number>): Promise<void> {
  try {
    process.exitCode = await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
