// The one place a script's database client gets its connection options (security scan 2026-10-10, F4, P-3120).
// node-postgres negotiates TLS only when `ssl` or `sslmode` is set, so a bare `new pg.Client({ connectionString })`
// talks to the Supabase pooler in plaintext. Every `pg.Client` under `scripts/` is built from `pgClientConfig(url)`;
// `tests/unit/pg-connect.test.ts` fails when a file under `scripts/` mentions a client and does not import this.
//
// Trust: the pooler's certificate chains to "Supabase Root 2021 CA", which is not a public root (a bare
// `ssl: { rejectUnauthorized: true }` ends in SELF_SIGNED_CERT_IN_CHAIN, measured 2026-10-11). The root is vendored as
// `supabase-ca.mjs` (SHA-256 80:70:25:AD:...:CA:FA, valid to 2031-04-26, the file Supabase publishes as
// prod-ca-2021.crt; its fingerprint equals the root the pooler presents). Refresh it before that date.
//
// Loopback is the one exception: the CI stack (`supabase start`, 127.0.0.1:54322) and a throwaway local cluster speak no
// TLS, and a loopback connection has no network path to intercept.
import { SUPABASE_ROOT_CA_2021 } from "./supabase-ca.mjs";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
// A libpq TLS parameter in the URL would override `ssl` below (pg lets the URL win), so the helper removes them.
const TLS_PARAMS = ["sslmode", "ssl", "sslcert", "sslkey", "sslrootcert", "uselibpqcompat"];

/**
 * @param {string | undefined} connectionString
 * @returns {import("pg").ClientConfig}
 */
export function pgClientConfig(connectionString) {
  if (connectionString === undefined || connectionString === "")
    throw new Error("pg-connect: no database URL; load the dev profile first");
  let url;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("pg-connect: the database URL is not a URL");
  }
  if (LOOPBACK.has(url.hostname)) return { connectionString };
  let stripped = connectionString;
  if (TLS_PARAMS.some((name) => url.searchParams.has(name))) {
    for (const name of TLS_PARAMS) url.searchParams.delete(name);
    stripped = url.toString();
  }
  return {
    connectionString: stripped,
    ssl: { rejectUnauthorized: true, ca: SUPABASE_ROOT_CA_2021 },
  };
}
