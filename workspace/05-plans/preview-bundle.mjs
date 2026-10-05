#!/usr/bin/env node
// Rebuild the GitHub secret PREVIEW_WORKER_SECRETS_JSON from the repository's `.env` (ruling F12: a later slice adds a
// preview secret by adding a key to that bundle, and the orchestrator updates it from `.env`). GitHub never returns a
// secret, so the bundle is always rebuilt whole, from the same mapping `app/scripts/dev-vars.mjs` uses plus the
// Worker-only keys below. Prints key names and yes/no facts, never a value.
//
//   node workspace/05-plans/preview-bundle.mjs            print the keys the bundle would hold
//   node workspace/05-plans/preview-bundle.mjs --set      write the GitHub secret
//   node workspace/05-plans/preview-bundle.mjs --set --worker matter-of-place-dev   also push every key to that Worker
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const APP = `${ROOT}app/`;
const dotenv = parseEnv(readFileSync(`${ROOT}.env`, "utf8").replaceAll("\r", ""));
const ref = dotenv["DEV_SUPABASE_PROJECT_REF"] ?? "";
if (ref === "") throw new Error("preview-bundle: .env has no DEV_SUPABASE_PROJECT_REF");

// The same table as dev-vars.mjs (name in the Worker, name in .env), then the Worker-only secrets of F12.
const TURNSTILE_TEST_SECRET = "1x0000000000000000000000000000000AA";
const bundle = {
  SUPABASE_URL: `https://${ref}.supabase.co`,
  TURNSTILE_SECRET: TURNSTILE_TEST_SECRET,
};
const copy = [
  ["SUPABASE_SERVICE_ROLE_KEY", "DEV_SUPABASE_SERVICE_ROLE_KEY", true],
  ["SENTRY_DSN", "SENTRY_DSN", true],
  ["RATE_LIMIT_SALT", "PREVIEW_RATE_LIMIT_SALT", true],
  ["SENTRY_TEST_TOKEN", "PREVIEW_SENTRY_TEST_TOKEN", false],
  ["RESEND_WEBHOOK_SECRET", "RESEND_WEBHOOK_SECRET", false],
  ["OPS_HEALTH_TOKEN", "OPS_HEALTH_TOKEN", false],
  ["RENDER_CALLBACK_SECRET", "RENDER_CALLBACK_SECRET", false],
  ["JOB_RUNNER_SECRET", "JOB_RUNNER_SECRET", false],
  ["PREVIEW_TOKEN_SECRET", "PREVIEW_TOKEN_SECRET", false],
  ["CONFIRM_TOKEN_SECRET", "CONFIRM_TOKEN_SECRET", false],
];
for (const [name, source, required] of copy) {
  const value = dotenv[source];
  if (value === undefined || value === "" || value.startsWith("PASTE")) {
    if (required) throw new Error(`preview-bundle: .env has no ${source} (needed for ${name})`);
    continue;
  }
  bundle[name] = value;
}
const keys = Object.keys(bundle);
console.log(`bundle keys (${keys.length}): ${keys.join(", ")}`);

const args = process.argv.slice(2);
if (args.includes("--set")) {
  execFileSync("gh", ["secret", "set", "PREVIEW_WORKER_SECRETS_JSON"], { input: JSON.stringify(bundle), stdio: ["pipe", "inherit", "inherit"] });
  console.log("GitHub secret PREVIEW_WORKER_SECRETS_JSON: set");
  const at = args.indexOf("--worker");
  if (at >= 0) {
    const worker = args[at + 1];
    const env = { ...process.env, CLOUDFLARE_API_TOKEN: dotenv["CLOUDFLARE_API_TOKEN"], CLOUDFLARE_ACCOUNT_ID: dotenv["CLOUDFLARE_ACCOUNT_ID"] };
    execFileSync("bunx", ["wrangler", "secret", "bulk", "--name", worker], { cwd: APP, input: JSON.stringify(bundle), stdio: ["pipe", "ignore", "inherit"], env, shell: true });
    console.log(`Worker ${worker}: ${keys.length} secrets put`);
  }
}
