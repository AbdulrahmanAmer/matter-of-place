import { verifyKey } from "./agent-keys.ts";
import type { Actor } from "./actor-types.ts";
import type { AppRole, Principal } from "./authz.ts";
import type { Db } from "./db.ts";
import { AppError } from "./errors.ts";
import { clientIp } from "./ids.ts";
import { getSessionUser } from "./session.ts";

// Who is calling `/api/admin/*`: a session cookie first, then a bearer agent key (S38). Roles are read on
// every request, never carried in the token, so a revoked role or a disabled account bites on the next
// call (invariant 17 (e)).

export type { Actor };

const BEARER = /^Bearer\s+(\S+)$/i;

const signIn = () => new AppError("unauthorized", undefined, "Please sign in.");

const busy = () =>
  new AppError("unavailable", undefined, "The service is busy. Please try again in a moment.");

/** The enabled roles of a user, from one read of `user_roles` (B2's `unique (user_id, role)` index). */
export async function enabledRoles(db: Db, userId: string): Promise<AppRole[]> {
  const { data, error } = await db
    .from("user_roles")
    .select("role, disabled_at")
    .eq("user_id", userId);
  if (error !== null) throw busy();
  return data.filter((row) => row.disabled_at === null).map((row) => row.role);
}

/**
 * What a signed-in session may act as (ruling H151, operator 2026-10-27): the same principal for every reader of a
 * session (`requireActor`, the admin page gate, the two sign-in paths). An agent account signed in through a browser
 * is the agent it is with its key, never a person: it is an agent account when any of its `user_roles` rows says
 * `agent` (the kind `write_audit` checks) or when it has ever held an `agent_keys` row, so either record alone fails
 * closed. Such a session acts only while the account holds a live key, with the roles that key gets and the scopes
 * every live key shares. Null is a session that may not act: no enabled role, or an agent account without a live key.
 * Both rows are read in parallel, on every request, like the key path.
 */
export async function sessionPrincipal(db: Db, userId: string): Promise<Principal | null> {
  const [roleRows, keyRows] = await Promise.all([
    db.from("user_roles").select("role, disabled_at, actor_kind").eq("user_id", userId),
    db.from("agent_keys").select("scopes, revoked_at").eq("user_id", userId),
  ]);
  if (roleRows.error !== null || keyRows.error !== null) throw busy();
  const roles = roleRows.data
    .filter((grant) => grant.disabled_at === null)
    .map((grant) => grant.role);
  if (roles.length === 0) return null;
  const agent = keyRows.data.length > 0 || roleRows.data.some((row) => row.actor_kind === "agent");
  if (!agent) return { kind: "human", roles, scopes: [] };
  const [first, ...others] = keyRows.data.filter((row) => row.revoked_at === null);
  if (first === undefined) return null;
  const scopes = first.scopes.filter((scope) => others.every((key) => key.scopes.includes(scope)));
  return { kind: "agent", roles, scopes };
}

export async function requireActor(request: Request, db: Db): Promise<Actor> {
  const user = await getSessionUser(request);
  if (user !== null) {
    const principal = await sessionPrincipal(db, user.userId);
    if (principal === null) {
      throw new AppError("account_disabled", undefined, "This account is not active.");
    }
    // An agent's session keeps its cookie session: CSRF and the session-age rules bind every cookie session alike.
    return {
      userId: user.userId,
      ...principal,
      session: { id: user.sessionId, signedInAt: user.signedInAt },
    };
  }
  const key = BEARER.exec(request.headers.get("authorization") ?? "")?.[1];
  if (key === undefined) throw signIn();
  const agent = await verifyKey(db, key, clientIp(request));
  return { userId: agent.userId, kind: "agent", roles: agent.roles, scopes: agent.scopes };
}
