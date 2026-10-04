// `bun run set-env -- --target dev --value development|preview|production` (B3b step 3, ruling H35): moves
// `settings.environment` through the RPC `set_environment`. There is one project, so `dev` is the only target.
// `production` is the last act of L1's launch switch; any other value first refuses a production database, so this
// script can never move the database back out of production.
import { guardEnv } from "./lib/guard-env.mjs";
import { parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";
import { assertNotProduction } from "./lib/assert-not-production.mjs";

const VALUES = ["development", "preview", "production"];

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`set-env: ${name} is not set`);
  return value;
}

/** Exits 2 on a target or value it does not know, before any network call. */
function parse(argv: string[]): { value: string } | { usage: string } {
  const { values } = parseArgs({
    args: argv,
    options: { target: { type: "string" }, value: { type: "string" } },
  });
  const { target = "", value = "" } = values;
  if (target !== "dev") return { usage: `unknown target ${target}` };
  if (!VALUES.includes(value)) return { usage: `unknown value ${value}` };
  return { value };
}

async function main(): Promise<number> {
  guardEnv();
  const args = parse(process.argv.slice(2));
  if ("usage" in args) {
    console.error(args.usage);
    return 2;
  }
  if (args.value !== "production") await assertNotProduction();
  // The dev profile's own names, never SUPABASE_URL (P-331); the key is read here and never printed (E10).
  const client = createClient(
    `https://${requiredEnv("DEV_SUPABASE_PROJECT_REF")}.supabase.co`,
    requiredEnv("DEV_SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { error } = await client.rpc("set_environment", { p_value: args.value });
  if (error !== null) {
    console.error(`set-env: ${error.message}`);
    return 1;
  }
  console.log(`settings.environment is ${args.value}`);
  return 0;
}

if (import.meta.main) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    },
  );
}
