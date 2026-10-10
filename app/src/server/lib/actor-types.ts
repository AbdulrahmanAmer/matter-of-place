import type { Principal } from "./authz.ts";

// The shapes of a signed-in caller, apart from the code that finds one. `actor.ts` and `admin-route.ts` import
// `session.ts` (`@supabase/ssr`, `jose`), which the Deno job runner's import map does not name, and `deno check`
// follows even a type-only import. A module the runner can reach imports its actor type from here (P-3111).

export interface Actor extends Principal {
  readonly userId: string;
  /** A cookie session's `session_id` claim and sign-in instant; absent for an agent key. */
  readonly session?: { readonly id: string; readonly signedInAt: number };
}

/** A signed-in person or agent key; services pass it on, and `auditContext` reads it. */
export interface AdminActor extends Actor {
  /** The router's `context.requestId`, set by the wrapper. */
  readonly requestId: string;
}
