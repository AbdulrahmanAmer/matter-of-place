// Global setup of the `db` project. guard-env comes first, so a shell holding an ops or `PROD_*` name stops the run
// before anything else (SEC-08).
import { guardEnv } from "../../scripts/lib/guard-env.mjs";
import { assertNotProduction } from "../../scripts/lib/assert-not-production.mjs";
import { isLocalDbUrl } from "../../scripts/lib/reset-guard.mjs";

// The session pooler of mop-dev (ASSUMED E4); the other allowed host is CI's ephemeral stack (T-01).
const POOLER_HOST = "aws-0-us-east-1.pooler.supabase.com";

export default async function setup(): Promise<void> {
  guardEnv();
  const dbUrl = process.env["DEV_DB_URL"];
  if (dbUrl === undefined || dbUrl === "") {
    throw new Error("refusing: DEV_DB_URL is not set (load the dev profile)");
  }
  if (!isLocalDbUrl(dbUrl)) {
    const url = new URL(dbUrl);
    const user = decodeURIComponent(url.username);
    const ref = process.env["DEV_SUPABASE_PROJECT_REF"] ?? "";
    if (url.hostname !== POOLER_HOST || ref === "" || user !== `postgres.${ref}`) {
      throw new Error(
        "refusing: DEV_DB_URL is neither 127.0.0.1 nor the mop-dev pooler with user postgres.<DEV_SUPABASE_PROJECT_REF>",
      );
    }
  }
  // After the launch switch database tests run only on the CI stack (invariant 23, ruling H35 (6)).
  await assertNotProduction({ dbUrl });
}
