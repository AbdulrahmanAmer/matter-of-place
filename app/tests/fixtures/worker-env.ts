// The environment `src/server/lib/env.ts` parses when a unit test first imports a module that reads it. Import this file
// first: modules evaluate in import order, so `process.env` is set before `env.ts` runs. A local Worker needs only the salt.
process.env["MOP_ENV"] = "local";
process.env["RATE_LIMIT_SALT"] = "unit-test-salt";
Reflect.deleteProperty(process.env, "SUPABASE_URL");

export const TEST_IP = "203.0.113.7";
