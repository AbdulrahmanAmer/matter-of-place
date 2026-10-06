// `bun run scripts/probe-amr.ts` with the dev profile loaded, before the launch switch only (ruling H35 (5)): signs
// the seeded managing editor in through a magic-link token hash and prints what the session policy and the CSRF
// token rely on (F26 g, API-05): the token's `amr` entries against `now`, and its `session_id` before and after a
// refresh. It sends no mail (`generateLink` only makes the link) and signs the session out at the end.
import { createClient } from "@supabase/supabase-js";
import { decodeJwt } from "jose";
import { z } from "zod";
import type { Database } from "../src/db/index.ts";
import { assertNotProduction } from "./lib/assert-not-production.mjs";
import { guardEnv } from "./lib/guard-env.mjs";

const EMAIL = "staff+managing@matterofplace.com";

const claimsSchema = z.object({
  session_id: z.string(),
  amr: z.array(z.object({ method: z.string(), timestamp: z.number() })),
});

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`probe-amr: ${name} is not set`);
  return value;
}

/** Built from the dev profile's own names, never SUPABASE_URL (P-331). */
function devClient() {
  return createClient<Database>(
    `https://${requiredEnv("DEV_SUPABASE_PROJECT_REF")}.supabase.co`,
    requiredEnv("DEV_SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

async function main(): Promise<void> {
  guardEnv();
  await assertNotProduction({ dbUrl: process.env["DEV_DB_URL"] });
  const link = await devClient().auth.admin.generateLink({ type: "magiclink", email: EMAIL });
  if (link.error !== null) throw new Error(`probe-amr: generateLink failed: ${link.error.message}`);
  const auth = devClient().auth;
  const verified = await auth.verifyOtp({
    token_hash: link.data.properties.hashed_token,
    type: "email",
  });
  const session = verified.data.session;
  if (session === null) throw new Error(`probe-amr: verifyOtp failed: ${String(verified.error)}`);
  const before = claimsSchema.parse(decodeJwt(session.access_token));
  console.log(`amr ${JSON.stringify(before.amr)}`);
  console.log(`now ${String(Math.floor(Date.now() / 1000))}`);
  console.log(`session_id before refresh ${before.session_id}`);
  const refreshed = await auth.refreshSession({ refresh_token: session.refresh_token });
  const next = refreshed.data.session;
  if (next === null)
    throw new Error(`probe-amr: refreshSession failed: ${String(refreshed.error)}`);
  const after = claimsSchema.parse(decodeJwt(next.access_token));
  console.log(`session_id after refresh ${after.session_id}`);
  console.log(`amr after refresh ${JSON.stringify(after.amr)}`);
  console.log(`same session_id ${String(before.session_id === after.session_id)}`);
  await auth.admin.signOut(next.access_token, "local");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
