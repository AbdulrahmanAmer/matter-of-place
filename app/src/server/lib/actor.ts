import { verifyKey } from "./agent-keys.ts";
import type { AppRole, Principal } from "./authz.ts";
import type { Db } from "./db.ts";
import { AppError } from "./errors.ts";
import { clientIp } from "./ids.ts";
import { getSessionUser } from "./session.ts";

// Who is calling `/api/admin/*`: a session cookie first, then a bearer agent key (S38). Roles are read on
// every request, never carried in the token, so a revoked role or a disabled account bites on the next
// call (invariant 17 (e)).

export interface Actor extends Principal {
  readonly userId: string;
  /** A cookie session's `session_id` claim and sign-in instant; absent for an agent key. */
  readonly session?: { readonly id: string; readonly signedInAt: number };
}

const BEARER = /^Bearer\s+(\S+)$/i;

const signIn = () => new AppError("unauthorized", undefined, "Please sign in.");

/** The enabled roles of a user, from one read of `user_roles` (B2's `unique (user_id, role)` index). */
export async function enabledRoles(db: Db, userId: string): Promise<AppRole[]> {
  const { data, error } = await db
    .from("user_roles")
    .select("role, disabled_at")
    .eq("user_id", userId);
  if (error !== null) {
    throw new AppError(
      "unavailable",
      undefined,
      "The service is busy. Please try again in a moment.",
    );
  }
  return data.filter((row) => row.disabled_at === null).map((row) => row.role);
}

export async function requireActor(request: Request, db: Db): Promise<Actor> {
  const user = await getSessionUser(request);
  if (user !== null) {
    const roles = await enabledRoles(db, user.userId);
    if (roles.length === 0) {
      throw new AppError("account_disabled", undefined, "This account is not active.");
    }
    return {
      userId: user.userId,
      kind: "human",
      roles,
      scopes: [],
      session: { id: user.sessionId, signedInAt: user.signedInAt },
    };
  }
  const key = BEARER.exec(request.headers.get("authorization") ?? "")?.[1];
  if (key === undefined) throw signIn();
  const agent = await verifyKey(db, key, clientIp(request));
  return { userId: agent.userId, kind: "agent", roles: agent.roles, scopes: agent.scopes };
}
