// `node scripts/dev-vars.mjs`: writes the git-ignored `app/.dev.vars` that `wrangler dev` reads (G-006, ASSUMED E10).
// Dev values only, taken from the repository's `.env`; no value is ever printed. It rewrites the keys below and
// keeps every other line of an existing `.dev.vars` (B7 adds PREVIEW_TOKEN_SECRET there).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";
import { guardEnv } from "./lib/guard-env.mjs";

guardEnv();

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const TARGET = fileURLToPath(new URL("../.dev.vars", import.meta.url));

// Cloudflare's always-pass Turnstile secret: the production secret never reaches a laptop.
const TURNSTILE_TEST_SECRET = "1x0000000000000000000000000000000AA";
const PLAIN_VALUE = /^[^\s"'#\\]+$/;

// What is copied from `.env`: the name in `.dev.vars`, the name in `.env`, whether `.env` must hold it.
const FROM_DOTENV = [
  { name: "SUPABASE_SERVICE_ROLE_KEY", source: "DEV_SUPABASE_SERVICE_ROLE_KEY", required: true },
  { name: "SENTRY_DSN", source: "SENTRY_DSN", required: true },
  { name: "RATE_LIMIT_SALT", source: "PREVIEW_RATE_LIMIT_SALT", required: true },
  { name: "SENTRY_TEST_TOKEN", source: "PREVIEW_SENTRY_TEST_TOKEN", required: false },
  { name: "RESEND_WEBHOOK_SECRET", source: "RESEND_WEBHOOK_SECRET", required: false },
  { name: "CONFIRM_TOKEN_SECRET", source: "CONFIRM_TOKEN_SECRET", required: false },
];

/**
 * @param {Record<string, string | undefined>} dotenv
 * @returns {Map<string, string>}
 */
function devVars(dotenv) {
  /** @type {Map<string, string>} */
  const vars = new Map();
  const ref = dotenv["DEV_SUPABASE_PROJECT_REF"];
  if (ref === undefined || ref === "") throw new Error(".env has no DEV_SUPABASE_PROJECT_REF");
  vars.set("SUPABASE_URL", `https://${ref}.supabase.co`);
  vars.set("TURNSTILE_SECRET", TURNSTILE_TEST_SECRET);
  vars.set("MOP_ENV", "local");
  for (const { name, source, required } of FROM_DOTENV) {
    const value = dotenv[source];
    if (value === undefined || value === "") {
      if (required) throw new Error(`.env has no ${source}`);
      continue;
    }
    vars.set(name, value);
  }
  for (const [name, value] of vars) {
    if (!PLAIN_VALUE.test(value)) throw new Error(`the value of ${name} cannot be written plain`);
  }
  return vars;
}

/**
 * The lines of an existing file that this script does not own.
 * @param {Map<string, string>} vars
 * @returns {string[]}
 */
function keptLines(vars) {
  if (!existsSync(TARGET)) return [];
  return readFileSync(TARGET, "utf8")
    .replaceAll("\r", "")
    .split("\n")
    .filter((line) => line.trim() !== "" && !vars.has(line.split("=")[0]?.trim() ?? ""));
}

function main() {
  const dotenv = parseEnv(readFileSync(`${ROOT}.env`, "utf8").replaceAll("\r", ""));
  const vars = devVars(dotenv);
  const lines = [...keptLines(vars), ...[...vars].map(([name, value]) => `${name}=${value}`)];
  writeFileSync(TARGET, `${lines.join("\n")}\n`);
  console.log(`wrote .dev.vars (${String(lines.length)} keys)`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
