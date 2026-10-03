import { createClient } from "@supabase/supabase-js";

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
  const ref = process.env["DEV_SUPABASE_PROJECT_REF"];
  const url = required(
    "SUPABASE_URL",
    ref === undefined || ref === "" ? undefined : `https://${ref}.supabase.co`,
  );
  const key = required("SUPABASE_SERVICE_ROLE_KEY", process.env["DEV_SUPABASE_SERVICE_ROLE_KEY"]);
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
