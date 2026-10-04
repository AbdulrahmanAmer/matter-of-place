// Imported first by every `tests/api/*.api.test.ts`, so it runs before `src/server/lib/env.ts` is first imported:
// the API tests run the Worker's code in process, against `mop-dev`, as a local Worker with Cloudflare's test secrets.
process.env["MOP_ENV"] = "local";
// Cloudflare's always-pass Turnstile secret, over any production secret the shell may hold.
process.env["TURNSTILE_SECRET"] = "1x0000000000000000000000000000000AA";
// Signs the bodies of `resend.api.test.ts`; the Worker verifies with the same value.
export const TEST_RESEND_WEBHOOK_SECRET = "whsec_dGVzdC1zZWNyZXQtZm9yLXRoZS1hcGktdGVzdHM=";
process.env["RESEND_WEBHOOK_SECRET"] = TEST_RESEND_WEBHOOK_SECRET;

// On the laptop the project is the dev profile's, whatever SUPABASE_URL a shell already holds (P-331); CI sets its own.
const ref = process.env["DEV_SUPABASE_PROJECT_REF"];
const serviceKey = process.env["DEV_SUPABASE_SERVICE_ROLE_KEY"];
if (ref !== undefined && ref !== "" && serviceKey !== undefined && serviceKey !== "") {
  process.env["SUPABASE_URL"] = `https://${ref}.supabase.co`;
  process.env["SUPABASE_SERVICE_ROLE_KEY"] = serviceKey;
}

if (!process.env["RATE_LIMIT_SALT"]) {
  const salt = process.env["PREVIEW_RATE_LIMIT_SALT"];
  if (salt === undefined || salt === "") {
    throw new Error(
      "PREVIEW_RATE_LIMIT_SALT is not set: load the dev profile of scripts/load-env.mjs",
    );
  }
  process.env["RATE_LIMIT_SALT"] = salt;
}

/** The token every write test sends in `x-turnstile-token`: the real siteverify accepts it with the test secret. */
export const TEST_TURNSTILE_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";
