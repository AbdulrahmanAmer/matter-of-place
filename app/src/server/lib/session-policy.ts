import type { Actor } from "./actor.ts";
import { AppError } from "./errors.ts";

// Session hardening (invariant 11, GS-02): Worker code, not a Supabase setting, so no paused or changed
// project setting loosens it. The sign-in instant is the `amr` timestamp of the verified token. An agent
// key is not a session and passes both checks; `authorize` refuses it on `team` and `settings` anyway.

const SESSION_HOURS = 12;

export function assertSessionFresh(actor: Actor, now: Date): void {
  if (actor.session === undefined) return;
  if (now.getTime() - actor.session.signedInAt > SESSION_HOURS * 3_600_000) {
    throw new AppError(
      "session_expired",
      undefined,
      "Your session has ended. Please sign in again.",
    );
  }
}

/** The matrix's `recentAuth` actions: a sign-in within the last `minutes`. */
export function requireRecentAuth(actor: Actor, now: Date, minutes = 15): void {
  if (actor.session === undefined) return;
  if (now.getTime() - actor.session.signedInAt > minutes * 60_000) {
    throw new AppError("reauth_required", undefined, "Please sign in again to continue.");
  }
}
