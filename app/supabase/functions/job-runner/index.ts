import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../../src/db/index.ts";
import { runOnce } from "@/server/jobs/runner.ts";
import { timingSafeEqual } from "@/server/lib/crypto.ts";
import { logLine } from "@/server/lib/log.ts";
import { captureException } from "@/server/lib/sentry.ts";

// The job runner's one entry point: pg_cron posts here every minute with the shared secret
// (architecture 5). Supabase checks no JWT (config.toml), so the bearer below is the only gate.

const encoder = new TextEncoder();

function authorised(request: Request): boolean {
  const secret = Deno.env.get("JOB_RUNNER_SECRET");
  const header = request.headers.get("authorization") ?? "";
  if (!secret || !header.startsWith("Bearer ")) return false;
  return timingSafeEqual(encoder.encode(header.slice("Bearer ".length)), encoder.encode(secret));
}

Deno.serve(async (request) => {
  if (!authorised(request)) return new Response("unauthorized", { status: 401 });

  const requestId = crypto.randomUUID();
  // The runner's own Sentry client key, so its rate limit is not the Worker's (INT-12). An unset
  // MOP_ENV tags production here, while liveSideEffects treats it as not production (H35 (8)).
  const sentry = {
    dsn: Deno.env.get("SENTRY_DSN"),
    requestId,
    route: "job-runner",
    side: "job-runner",
    env: Deno.env.get("MOP_ENV") ?? "production",
    release: Deno.env.get("SENTRY_RELEASE") ?? "dev",
  } as const;

  try {
    const db = createClient<Database>(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );
    const summary = await runOnce(db, {
      env: Deno.env.toObject(),
      report: (error, { fingerprint, level }) =>
        captureException(error, { ...sentry, fingerprint, ...(level && { level }) }),
    });
    return Response.json(summary);
  } catch (error) {
    logLine("error", "unhandled_error", { requestId });
    await captureException(error, sentry);
    return Response.json({ error: "runner_failed" }, { status: 500 });
  }
});
