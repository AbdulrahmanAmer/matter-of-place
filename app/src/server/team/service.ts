import { parseCookieHeader } from "@supabase/ssr";
import {
  isAuthApiError,
  isAuthRetryableFetchError,
  type PostgrestError,
} from "@supabase/supabase-js";
import { z } from "zod";
import {
  agentKeySchema,
  agentKeysInputSchema,
  dailyLimitsSchema,
  teamUserSchema,
  teamUsersInputSchema,
  type AgentCreateInput,
  type agentKeysPageSchema,
  type DailyLimits,
  type InviteInput,
  type KeyCreated,
  type KeyCreateInput,
  type meSchema,
  type sendLinkInput,
  type teamUsersPageSchema,
  type verifyInput,
} from "../../domain/admin-team.ts";
import { enabledRoles } from "../lib/actor.ts";
import { fromRpcError } from "../lib/admin-errors.ts";
import type { AdminActor } from "../lib/admin-route.ts";
import { adminJson } from "../lib/admin-response.ts";
import { generateKey, hashAgentKey } from "../lib/agent-keys.ts";
import { auditContext } from "../lib/audit.ts";
import { authorize, can, matrix, type AppRole } from "../lib/authz.ts";
import {
  CSRF_COOKIE,
  csrfCookie,
  csrfTokenFor,
  expireCsrfCookie,
  safeNext,
  sameOrigin,
} from "../lib/csrf.ts";
import type { Db } from "../lib/db.ts";
import type { env } from "../lib/env.ts";
import { AppError } from "../lib/errors.ts";
import { clientIp, hashKey } from "../lib/ids.ts";
import { logLine } from "../lib/log.ts";
import { checkDb, checkMemory } from "../lib/ratelimit.ts";
import { authClient, sessionIdOf, takeIssuedCookies } from "../lib/session.ts";
import { verifyTurnstile } from "../lib/turnstile.ts";

// Staff sign-in (invariant 19, API-01) and `GET me` (invariants 2 and 11). A sign-in link is mailed only to
// an address that holds an enabled role, and the answer never says which addresses those are.

type WorkerEnv = typeof env;

const SEND_LINK = "auth-send-link";
const HOUR_MS = 3_600_000;
const PER_IP = 5;
const PER_EMAIL = 3;
const SENT = { status: "sent" } as const;

const unavailable = () =>
  new AppError(
    "auth_unavailable",
    undefined,
    "Sign-in is unavailable at the moment. Please try again shortly.",
  );

const seeOther = (location: string) => new Response(null, { status: 303, headers: { location } });

export async function getMe(
  actor: AdminActor,
  request: Request,
  environment: WorkerEnv,
): Promise<Response> {
  authorize(actor, "me");
  const body: z.input<typeof meSchema> = {
    actor: { id: actor.userId },
    kind: actor.kind,
    roles: [...actor.roles],
    scopes: [...actor.scopes],
    actions: matrix.filter((entry) => can(actor, entry.action)).map((entry) => entry.action),
    environment: environment.MOP_ENV,
  };
  const headers = new Headers();
  const key = environment.CSRF_SECRET;
  // The layout calls `me` on every load, so a lost or stale token cookie is put back here (API-05).
  if (actor.session !== undefined && key !== undefined) {
    const token = await csrfTokenFor(actor.session.id, key);
    const cookies = parseCookieHeader(request.headers.get("cookie") ?? "");
    const current = cookies.find((cookie) => cookie.name === CSRF_COOKIE)?.value;
    if (current !== token) headers.append("set-cookie", csrfCookie(token));
  }
  return adminJson(body, { headers });
}

/** Why a link is not sent, before the address is even looked up; null when every check passes. */
async function refusal(
  db: Db,
  request: Request,
  environment: WorkerEnv,
  email: string,
): Promise<string | null> {
  const ip = clientIp(request);
  const turnstile = await verifyTurnstile(
    request.headers.get("x-turnstile-token"),
    ip,
    environment,
    SEND_LINK,
  );
  if (turnstile === "fail") return "turnstile";
  if (turnstile === "unreachable") logLine("warn", "turnstile_unreachable", { route: SEND_LINK });
  if (!checkMemory(`${SEND_LINK}:ip`, ip, PER_IP, HOUR_MS).ok) return "memory";
  const salt = environment.RATE_LIMIT_SALT;
  const limits = await checkDb(db, [
    {
      bucket: `${SEND_LINK}:ip`,
      keyHash: await hashKey(salt, ip),
      limit: PER_IP,
      windowSeconds: 3600,
    },
    {
      bucket: `${SEND_LINK}:email`,
      keyHash: await hashKey(salt, email),
      limit: PER_EMAIL,
      windowSeconds: 3600,
    },
  ]);
  return limits.ok ? null : "limit";
}

/** Always answers `sent`: a refusal, an unknown address and a mail failure look the same from outside. */
export async function sendSignInLink(
  db: Db,
  request: Request,
  environment: WorkerEnv,
  input: z.output<typeof sendLinkInput>,
): Promise<typeof SENT> {
  const reason = await refusal(db, request, environment, input.email);
  if (reason !== null) {
    logLine("warn", "send_link_limited", { reason });
    return SENT;
  }
  const staff = await db.rpc("staff_can_sign_in", { p_email: input.email });
  if (staff.error !== null) throw fromRpcError(staff.error);
  if (!staff.data) return SENT;
  // No redirect option: B5's template builds the token-hash link to the confirm page itself.
  const { error } = await authClient(request).auth.signInWithOtp({
    email: input.email,
    options: { shouldCreateUser: false },
  });
  if (error !== null) logLine("warn", "auth_send_failed", { status: error.status ?? 0 });
  return SENT;
}

/** The confirm page's POST: spends the token hash, checks the roles once and sets the session cookies. */
export async function verifySignIn(
  db: Db,
  request: Request,
  environment: WorkerEnv,
  input: z.output<typeof verifyInput>,
): Promise<Response> {
  if (!sameOrigin(request)) {
    throw new AppError("csrf", undefined, "Please open the sign-in link again.");
  }
  const client = authClient(request);
  const { data, error } = await client.auth.verifyOtp({
    type: input.type,
    token_hash: input.token_hash,
  });
  if (error !== null && isAuthRetryableFetchError(error)) throw unavailable();
  const session = data.session;
  if (session === null) return seeOther("/admin/sign-in?state=expired");
  const roles = await enabledRoles(db, session.user.id);
  if (roles.length === 0) {
    await client.auth.signOut();
    // The session is signed out again, so none of its cookies leave the Worker.
    takeIssuedCookies(request);
    return seeOther("/admin/sign-in?state=disabled");
  }
  const response = seeOther(safeNext(input.next));
  const key = environment.CSRF_SECRET;
  if (key !== undefined) {
    const token = await csrfTokenFor(sessionIdOf(session.access_token), key);
    response.headers.append("set-cookie", csrfCookie(token));
  }
  return response;
}

/** Ends the session at Supabase Auth and expires its cookies and `mop_csrf`. */
export async function signOut(actor: AdminActor, request: Request): Promise<Response> {
  authorize(actor, "me");
  const { error } = await authClient(request).auth.signOut();
  if (error !== null && isAuthRetryableFetchError(error)) throw unavailable();
  const response = new Response(null, { status: 204 });
  response.headers.append("set-cookie", expireCsrfCookie());
  return response;
}

// Screen 23 (step 14). Every function authorizes first (SEC-04); the matrix makes each one admin-only, person-only and
// recent-sign-in-only. Each write is one RPC that audits through `write_audit`. Invite and agent creation make the auth
// account first and delete it again when its role cannot be written, so no account is left without a role.

const teamWriteFailed = () =>
  new AppError(
    "team_write_failed",
    undefined,
    "The account could not be set up. Nothing was kept.",
  );

/** The error of an auth admin call: an outage is 503, anything else a reported 500. */
function authFailure(error: Error): AppError {
  if (isAuthRetryableFetchError(error)) return unavailable();
  return new AppError("server", undefined, "Something went wrong. Please try again in a moment.");
}

/** The data of a PostgREST answer, or its error translated by `fromRpcError`. */
async function rpcOrThrow<T>(
  answer: PromiseLike<{ data: T; error: null } | { data: null; error: PostgrestError }>,
): Promise<T> {
  const result = await answer;
  if (result.error !== null) throw fromRpcError(result.error);
  return result.data;
}

/** Runs the role writes of a new account; when one fails, the account is deleted and the answer is 500. */
async function keepOrDelete<T>(db: Db, userId: string, write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (failure) {
    const { error } = await db.auth.admin.deleteUser(userId);
    logLine("error", "team_account_rolled_back", {
      userId,
      code: fromRpcError(failure).code,
      deleted: error === null,
    });
    throw teamWriteFailed();
  }
}

/** `GET team/users`: one page of people and agent accounts with their roles. */
export async function listUsers(
  actor: AdminActor,
  db: Db,
  page: z.input<typeof teamUsersInputSchema>,
): Promise<z.output<typeof teamUsersPageSchema>> {
  authorize(actor, "team.users_list");
  const { limit, cursor } = teamUsersInputSchema.parse(page);
  const answer = await rpcOrThrow(
    db.rpc("team_users", { p_limit: limit, ...(cursor === undefined ? {} : { p_cursor: cursor }) }),
  );
  const rows = z.array(teamUserSchema).parse(answer);
  const last = rows.at(-1);
  return {
    items: rows,
    next_cursor: rows.length === limit && last !== undefined ? last.user_id : null,
  };
}

/** `POST team/users`: Supabase Auth mails the invitation; `grant_role` writes each role, with note `invite`. */
export async function inviteUser(
  actor: AdminActor,
  db: Db,
  input: InviteInput,
): Promise<{ user_id: string }> {
  authorize(actor, "team.invite");
  const { data, error } = await db.auth.admin.inviteUserByEmail(input.email);
  if (error !== null) {
    if (isAuthApiError(error) && error.code === "email_exists") {
      throw new AppError("already_exists", undefined, "This address already has an account.");
    }
    throw authFailure(error);
  }
  const userId = data.user.id;
  await keepOrDelete(db, userId, async () => {
    for (const role of input.roles) {
      await rpcOrThrow(
        db.rpc("grant_role", {
          p_user: userId,
          p_role: role,
          p_note: "invite",
          p_display_name: input.display_name,
          ...auditContext(actor),
        }),
      );
    }
  });
  return { user_id: userId };
}

/** `POST team/users/:id/roles`. */
export async function grantRole(
  actor: AdminActor,
  db: Db,
  input: { id: string; role: AppRole; note?: string | undefined },
): Promise<{ id: string }> {
  authorize(actor, "team.role_grant");
  const id = await rpcOrThrow(
    db.rpc("grant_role", {
      p_user: input.id,
      p_role: input.role,
      p_note: input.note ?? "",
      ...auditContext(actor),
    }),
  );
  return { id };
}

/** `DELETE team/users/:id/roles/:role`; refused with `last_admin` for the last enabled admin. */
export async function revokeRole(
  actor: AdminActor,
  db: Db,
  input: { id: string; role: AppRole },
): Promise<{ revoked: true }> {
  authorize(actor, "team.role_revoke");
  await rpcOrThrow(
    db.rpc("revoke_role", { p_user: input.id, p_role: input.role, ...auditContext(actor) }),
  );
  return { revoked: true };
}

/** `POST team/users/:id/disable`; refused with `last_admin` for the last enabled admin. */
export async function setUserDisabled(
  actor: AdminActor,
  db: Db,
  input: { id: string; disabled: boolean },
): Promise<{ disabled: boolean }> {
  authorize(actor, "team.user_disable");
  const disabled = await rpcOrThrow(
    db.rpc("set_user_disabled", {
      p_user: input.id,
      p_disabled: input.disabled,
      ...auditContext(actor),
    }),
  );
  return { disabled };
}

/** Writes the sha256 of a new key; the key itself goes back to the caller once and is kept nowhere. */
async function issueKey(
  actor: AdminActor,
  db: Db,
  userId: string,
  input: { label: string; scopes: readonly string[] },
  environment: string,
): Promise<KeyCreated> {
  const key = generateKey(environment);
  const keyId = await rpcOrThrow(
    db.rpc("create_agent_key", {
      p_user: userId,
      p_hash: await hashAgentKey(key),
      p_label: input.label,
      p_scopes: [...input.scopes],
      ...auditContext(actor),
    }),
  );
  return { user_id: userId, key_id: keyId, key };
}

/** `POST team/agents`: an auth account at an `.invalid` address, its one role as an agent, and its first key. */
export async function createAgent(
  actor: AdminActor,
  db: Db,
  input: AgentCreateInput,
  environment: string,
): Promise<KeyCreated> {
  authorize(actor, "team.agent_create");
  const { data, error } = await db.auth.admin.createUser({
    email: `agent-${crypto.randomUUID()}@matterofplace.invalid`,
    email_confirm: true,
  });
  if (error !== null) throw authFailure(error);
  const userId = data.user.id;
  return keepOrDelete(db, userId, async () => {
    await rpcOrThrow(
      db.rpc("grant_role", {
        p_user: userId,
        p_role: input.role,
        p_note: "agent_create",
        p_user_kind: "agent",
        p_display_name: input.label,
        ...auditContext(actor),
      }),
    );
    return issueKey(actor, db, userId, input, environment);
  });
}

/** `POST team/agents/:id/keys`: another key for an existing agent account. */
export async function createAgentKey(
  actor: AdminActor,
  db: Db,
  input: KeyCreateInput,
  environment: string,
): Promise<KeyCreated> {
  authorize(actor, "team.agent_key_create");
  return issueKey(actor, db, input.id, input, environment);
}

/** `DELETE team/agents/:id/keys/:keyId`. */
export async function revokeAgentKey(
  actor: AdminActor,
  db: Db,
  input: { keyId: string },
): Promise<{ revoked: true }> {
  authorize(actor, "team.agent_key_revoke");
  await rpcOrThrow(db.rpc("revoke_agent_key", { p_key: input.keyId, ...auditContext(actor) }));
  return { revoked: true };
}

/** `POST team/agents/revoke-all`: every live key at once, with one audit row that holds the count. */
export async function revokeAllAgentKeys(actor: AdminActor, db: Db): Promise<{ revoked: number }> {
  authorize(actor, "team.revoke_all_keys");
  return { revoked: await rpcOrThrow(db.rpc("revoke_all_agent_keys", auditContext(actor))) };
}

/** `GET team/agents`: one page of agent keys, keyset on the key id; the hash is never read. */
export async function listAgentKeys(
  actor: AdminActor,
  db: Db,
  page: z.input<typeof agentKeysInputSchema>,
): Promise<z.output<typeof agentKeysPageSchema>> {
  authorize(actor, "team.users_list");
  const { limit, cursor } = agentKeysInputSchema.parse(page);
  const query = db
    .from("agent_keys")
    .select("id, user_id, label, scopes, last_used_at, revoked_at, created_at")
    .order("id")
    .limit(limit);
  const answer = await rpcOrThrow(cursor === undefined ? query : query.gt("id", cursor));
  const rows = z.array(agentKeySchema).parse(answer);
  const last = rows.at(-1);
  return {
    items: rows,
    next_cursor: rows.length === limit && last !== undefined ? last.id : null,
  };
}

/** `GET team/limits`. */
export async function getDailyLimits(actor: AdminActor, db: Db): Promise<DailyLimits> {
  authorize(actor, "team.users_list");
  const rows = await rpcOrThrow(
    db.from("settings").select("value").eq("key", "agent_daily_limits"),
  );
  return dailyLimitsSchema.parse(rows[0]?.value);
}

/** `PUT team/limits`: the three caps as one value, audited as `team.limits_put`. */
export async function putDailyLimits(
  actor: AdminActor,
  db: Db,
  input: DailyLimits,
): Promise<DailyLimits> {
  authorize(actor, "team.limits_put");
  const saved = await rpcOrThrow(
    db.rpc("put_setting", {
      p_key: "agent_daily_limits",
      p_value: input,
      ...auditContext(actor),
    }),
  );
  return dailyLimitsSchema.parse(saved);
}
