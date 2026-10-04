import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../db";
import { env } from "./env";
import { AppError } from "./errors.ts";

/** The client type every service and test imports from here, so only this file knows supabase-js (invariant 1). */
export type Db = SupabaseClient<Database>;

// The two reads of the public read path (invariant 15). One that has not answered in this long
// is abandoned, so the caller can serve its last good copy (invariant 16).
const READ_RPC = /\/rest\/v1\/rpc\/(?:public_state|public_catalog_snapshot)$/;
const READ_TIMEOUT_MS = 2000;

let calls = 0;
let client: Db | undefined;

/** Every request to Supabase since the last reset. Only tests and local runs read it (invariant 18). */
export const dbCallCount = (): number => calls;

export function resetDbCallCount(): void {
  calls = 0;
}

// `typeof fetch` also lists Bun's `preconnect`; the Worker never calls it.
const countedFetch: typeof fetch = Object.assign(
  (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    calls += 1;
    const url = new URL(input instanceof Request ? input.url : input);
    if (!READ_RPC.test(url.pathname)) return fetch(input, init ?? {});
    const timeout = AbortSignal.timeout(READ_TIMEOUT_MS);
    const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    return fetch(input, { ...init, signal });
  },
  { preconnect: () => undefined },
);

/** One service-role client per isolate. Throws 503 `unavailable` when the Worker holds no Supabase key. */
export function getDb(): Db {
  if (client) return client;
  const { SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: key } = env;
  if (url === undefined || key === undefined) {
    throw new AppError("unavailable", undefined, "The database is not available.");
  }
  client = createClient<Database, "public">(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: countedFetch },
  });
  return client;
}

/** Swaps the client in unit tests with the value `fakeDb` returns; `undefined` puts the real one back. */
export function setDbForTests(fake: Db | undefined): void {
  client = fake;
}
