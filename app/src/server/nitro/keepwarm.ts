import { definePlugin } from "nitro";
import { getDb, type Db } from "../lib/db.ts";
import { env, sentryOptions } from "../lib/env.ts";
import { logLine } from "../lib/log.ts";
import { readVar } from "../lib/runtime-env.ts";
import { captureException } from "../lib/sentry.ts";
import { runKeepWarm } from "../scheduled.ts";

// The keep-warm tick (B8b invariant 15 c): Nitro's Cloudflare module preset calls the `cloudflare:scheduled` hook from
// the Worker's `scheduled()` export, and the page request goes through `nitroApp.fetch`, so it never leaves the isolate.

/** The client of this tick, or undefined after one `keepwarm_env_missing` line: a tick never throws. */
function tickDb(): Db | undefined {
  try {
    return getDb();
  } catch {
    logLine("error", "keepwarm_env_missing", {
      name: env.SUPABASE_URL === undefined ? "SUPABASE_URL" : "SUPABASE_SERVICE_ROLE_KEY",
    });
    return undefined;
  }
}

export default definePlugin((nitroApp) => {
  // The hook's own type names `ScheduledController` from a package this project does not install.
  nitroApp.hooks.hook(
    "cloudflare:scheduled",
    ({ controller }: { controller: { cron: string } }) => {
      const db = tickDb();
      if (db === undefined) return undefined;
      return runKeepWarm({
        db,
        fetch: (request) => Promise.resolve(nitroApp.fetch(request)),
        cron: controller.cron,
        origin: import.meta.env.VITE_SITE_URL ?? "https://matterofplace.com",
        now: new Date(),
        mopEnv: readVar("MOP_ENV"),
        report: (error, options) =>
          captureException(error, {
            ...options,
            ...sentryOptions(),
            requestId: crypto.randomUUID(),
            route: "keepwarm",
          }),
      });
    },
  );
});
