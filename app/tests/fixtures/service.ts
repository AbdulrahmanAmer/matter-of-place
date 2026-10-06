import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../src/db";

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === "") throw new Error(`${name} is not set`);
  return value;
}

/**
 * A service-role client for `mop-dev` or the CI stack, for reads, RPCs and the `coming_soon_global` toggle. It holds no
 * guard (H35 (5)): every writer that uses it has called `assertNotProduction` first. It never deletes; deletes go
 * through `removeFixtureRows` over `pg`. On the laptop the dev profile of `load-env.mjs` sets `DEV_SUPABASE_PROJECT_REF`
 * and `DEV_SUPABASE_SERVICE_ROLE_KEY`; CI sets `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` for its own stack.
 */
export function serviceClient() {
  // The dev profile first, always: on the operator's laptop `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are
  // Windows user-level variables of another business's project, and a client built from them wrote there on
  // 2026-10-06 (G-901, P-331). Those two names are read only behind `E2E_STACK=1`, which ci.yml sets for its
  // ephemeral stack and no laptop shell has.
  const ref = process.env["DEV_SUPABASE_PROJECT_REF"] ?? "";
  const devKey = process.env["DEV_SUPABASE_SERVICE_ROLE_KEY"] ?? "";
  const [url, key] =
    ref !== "" && devKey !== ""
      ? [`https://${ref}.supabase.co`, devKey]
      : process.env["E2E_STACK"] === "1"
        ? [required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY")]
        : [required("DEV_SUPABASE_PROJECT_REF"), required("DEV_SUPABASE_SERVICE_ROLE_KEY")];
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
