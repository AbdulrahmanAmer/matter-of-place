// The environment `src/server/lib/env.ts` parses when a unit test first imports a module that reads it. Import this file
// first: modules evaluate in import order, so `process.env` is set before `env.ts` runs. A local Worker needs only the salt.
process.env["MOP_ENV"] = "local";
process.env["RATE_LIMIT_SALT"] = "unit-test-salt";
// Unit tests never reach a database, so the ambient `SUPABASE_URL` goes (G-901). Behind `E2E_STACK=1`, which only ci.yml sets,
// it is the CI stack's own URL, and a db test reads it through `serviceClient`.
if (process.env["E2E_STACK"] !== "1") Reflect.deleteProperty(process.env, "SUPABASE_URL");

export const TEST_IP = "203.0.113.7";
