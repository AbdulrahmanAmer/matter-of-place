// `eval "$(node scripts/load-env.mjs --profile dev)"`: exports the allow-listed names of one profile into the calling
// shell (SEC-08, ASSUMED E10). `dev` reads the repository's `.env`, `ops` its `.env.ops` (both git-ignored). It refuses
// when standard output is a terminal, so a value never reaches the screen; later slices extend `profiles`.
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

const profiles = new Map([
  [
    "dev",
    {
      file: ".env",
      names: [
        "DEV_DB_URL",
        "DEV_SUPABASE_PROJECT_REF",
        "DEV_SUPABASE_DB_PASSWORD",
        "DEV_SUPABASE_SERVICE_ROLE_KEY",
        "PREVIEW_RATE_LIMIT_SALT",
        "OPS_HEALTH_TOKEN",
        "OMNIKOM_MOCK_SECRET",
        "JOB_RUNNER_SECRET",
      ],
    },
  ],
  [
    "ops",
    {
      file: ".env.ops",
      names: [
        "CLOUDFLARE_API_TOKEN",
        "CF_EDGE_TOKEN",
        "SUPABASE_ACCESS_TOKEN",
        "OMNIKOM_WEBHOOK_URL",
        "OMNIKOM_WEBHOOK_SECRET",
      ],
    },
  ],
]);

/**
 * @param {string} value
 * @returns {string}
 */
function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function main() {
  const [flag, name, ...rest] = process.argv.slice(2);
  const profile = flag === "--profile" && rest.length === 0 ? profiles.get(name ?? "") : undefined;
  if (profile === undefined) {
    console.error(
      `usage: eval "$(node scripts/load-env.mjs --profile ${[...profiles.keys()].join("|")})"`,
    );
    return 1;
  }
  if (process.stdout.isTTY) {
    console.error(
      'load-env: standard output is a terminal; run it as eval "$(node scripts/load-env.mjs ...)"',
    );
    return 1;
  }
  const values = parseEnv(readFileSync(`${ROOT}${profile.file}`, "utf8").replaceAll("\r", ""));
  const lines = [];
  for (const key of profile.names) {
    const value = values[key];
    if (value === undefined) console.error(`load-env: ${profile.file} has no ${key}`);
    else lines.push(`export ${key}=${shellQuote(value)}`);
  }
  // The dev profile also overwrites the two generic names in the shell with mop-dev's values. On the operator's
  // laptop they are Windows user-level variables of another business's Supabase project, and a client that read them
  // wrote there on 2026-10-06 (G-901, P-331). After this, a stray reader of SUPABASE_URL still reaches mop-dev.
  if (name === "dev") {
    const ref = values["DEV_SUPABASE_PROJECT_REF"];
    const key = values["DEV_SUPABASE_SERVICE_ROLE_KEY"];
    if (ref !== undefined && key !== undefined) {
      lines.push(`export SUPABASE_URL=${shellQuote(`https://${ref}.supabase.co`)}`);
      lines.push(`export SUPABASE_SERVICE_ROLE_KEY=${shellQuote(key)}`);
    }
  }
  process.stdout.write(`${lines.join("\n")}\n`);
  return 0;
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
