// Sends one Supabase Auth invite through the project's SMTP (B5 step 8), from a shell that loaded the dev profile:
//   eval "$(node scripts/load-env.mjs --profile dev)"; bun run scripts/auth-invite-test.ts <address>
// It creates an auth user in the one cloud database, so it refuses once `settings.environment` is production (ruling
// H35 (5)). No secret is printed.
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { assertNotProduction } from "./lib/assert-not-production.mjs";
import { devProject } from "./lib/storage-env.ts";

async function main(): Promise<void> {
  await assertNotProduction({ dbUrl: process.env["DEV_DB_URL"] });
  const address = z.string().email().safeParse(process.argv[2]);
  if (!address.success) throw new Error("usage: auth-invite-test.ts <address>");
  const project = devProject();
  const { error } = await createClient(project.url, project.key, {
    auth: { autoRefreshToken: false, persistSession: false },
  }).auth.admin.inviteUserByEmail(address.data);
  if (error !== null) throw new Error(`auth-invite-test: ${error.message}`);
  console.log(`invited ${address.data}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
