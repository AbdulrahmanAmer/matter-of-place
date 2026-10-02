// SEC-08: keeps ops credentials out of test and dev-script shells. It is not the production guard; that is
// assert-not-production.mjs (B2 invariant 23, ruling H35).

const OPS_NAME = /^PROD_|^SUPABASE_ACCESS_TOKEN$|^CLOUDFLARE_API_TOKEN$|^CF_EDGE_TOKEN$|^BACKUP_/;

/**
 * Throws naming every ops variable in the environment unless `allowOps` is set.
 * @param {{ allowOps?: boolean, env?: Record<string, string | undefined> }} [options]
 */
export function guardEnv({ allowOps = false, env = process.env } = {}) {
  if (allowOps) return;
  const found = Object.keys(env)
    .filter((name) => OPS_NAME.test(name))
    .sort();
  if (found.length > 0) {
    throw new Error(
      `refusing: ops variables in this shell ${found.join(" ")} (load the dev profile in a fresh shell)`,
    );
  }
}
