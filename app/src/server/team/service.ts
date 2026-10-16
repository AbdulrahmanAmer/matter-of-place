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
  type passwordSignInInput,
  type sendLinkInput,
  type setPasswordInput,
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
import { passwordWasPwned } from "../lib/pwned.ts";
import { verifyTurnstile } from "../lib/turnstile.ts";

// Staff sign-in (invariant 19, API-01) and `GET me` (invariants 2 and 11). A sign-in link is mailed only to
// an address that holds an enabled role, and the answer never says which addresses those are.

type WorkerEnv = typeof env;

const HOUR_MS = 3_600_000;

/** The Turnstile action, the rate-limit buckets and the hourly limits of one open sign-in route. */
interface OpenLimits {
  route: string;
  perIp: number;
  perEmail: number;
}

const SEND_LINK: OpenLimits = { route: "auth-send-link", perIp: 5, perEmail: 3 };
// A typo costs one try, so the password path allows a few more than the link path.
const PASSWORD: OpenLimits = { route: "auth-password", perIp: 10, perEmail: 8 };
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

/** Why an open sign-in call is refused, before the address is even looked up; null when every check passes. */
async function refusal(
  db: Db,
  request: Request,
  environment: WorkerEnv,
  email: string,
  limits: OpenLimits,
): Promise<string | null> {
  const ip = clientIp(request);
  const turnstile = await verifyTurnstile(
    request.headers.get("x-turnstile-token"),
    ip,
    environment,
    limits.route,
  );
  if (turnstile === "fail") return "turnstile";
  if (turnstile === "unreachable")
    logLine("warn", "turnstile_unreachable", { route: limits.route });
  if (!checkMemory(`${limits.route}:ip`, ip, limits.perIp, HOUR_MS).ok) return "memory";
  const salt = environment.RATE_LIMIT_SALT;
  const checked = await checkDb(db, [
    {
      bucket: `${limits.route}:ip`,
      keyHash: await hashKey(salt, ip),
      limit: limits.perIp,
      windowSeconds: 3600,
    },
    {
      bucket: `${limits.route}:email`,
      keyHash: await hashKey(salt, email),
      limit: limits.perEmail,
      windowSeconds: 3600,
    },
  ]);
  return checked.ok ? null : "limit";
}

/** Always answers `sent`: a refusal, an unknown address and a mail failure look the same from outside. */
export async function sendSignInLink(
  db: Db,
  request: Request,
  environment: WorkerEnv,
  input: z.output<typeof sendLinkInput>,
): Promise<typeof SENT> {
  const reason = await refusal(db, request, environment, input.email, SEND_LINK);
  if (reason !== null) {
    logLine("warn", "send_link_limited", { reason });
    return SENT;
  }
  const staff = await db.rpc("staff_can_sign_in", { p_email: input.email });
  if (staff.error !== null) throw fromRpcError(staff.error);
  if (!staff.data) return SENT;
  // No redirect option: B5's template builds the token-hash link to the confirm page itself.
  const { error } = await authClient(request).signInWithOtp({
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
  const { data, error } = await client.verifyOtp({
    type: input.type,
    token_hash: input.token_hash,
  });
  if (error !== null && isAuthRetryableFetchError(error)) throw unavailable();
  const session = data.session;
  if (session === null) return seeOther("/admin/sign-in?state=expired");
  const roles = await enabledRoles(db, session.user.id);
  if (roles.length === 0) {
    await client.signOut();
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

/**
 * The sign-in screen's password path: the same bot check and hourly limits as the link, then Supabase Auth checks the
 * pair, the roles are read once, and the session and `mop_csrf` cookies are set. A wrong pair, an unknown address and
 * an account without a password all answer the same 401, so the answer says nothing about who is on the team.
 */
export async function signInWithPassword(
  db: Db,
  request: Request,
  environment: WorkerEnv,
  input: z.output<typeof passwordSignInInput>,
): Promise<Response> {
  if (!sameOrigin(request)) {
    throw new AppError("csrf", undefined, "Please reload the page and try again.");
  }
  const reason = await refusal(db, request, environment, input.email, PASSWORD);
  if (reason !== null) {
    logLine("warn", "password_limited", { reason });
    throw new AppError(
      "rate_limited",
      undefined,
      "Too many tries. Wait an hour, or ask for a sign-in link instead.",
    );
  }
  const client = authClient(request);
  const { data, error } = await client.signInWithPassword({
    email: input.email,
    password: input.password,
  });
  if (error !== null && isAuthRetryableFetchError(error)) throw unavailable();
  const session = data.session;
  if (session === null) {
    throw new AppError("unauthorized", undefined, "That email and password do not match.");
  }
  const roles = await enabledRoles(db, session.user.id);
  if (roles.length === 0) {
    await client.signOut();
    // The session is signed out again, so none of its cookies leave the Worker.
    takeIssuedCookies(request);
    throw new AppError(
      "account_disabled",
      undefined,
      "This account is not active. Ask an administrator if that is unexpected.",
    );
  }
  const response = adminJson({ next: safeNext(input.next) });
  const key = environment.CSRF_SECRET;
  if (key !== undefined) {
    const token = await csrfTokenFor(sessionIdOf(session.access_token), key);
    response.headers.append("set-cookie", csrfCookie(token));
  }
  return response;
}

/**
 * A signed-in person sets their own password (it never passes through anyone else). The matrix makes it person-only
 * and recent-sign-in-only; the audit row says that it changed, never what it is.
 */
export async function setOwnPassword(
  actor: AdminActor,
  db: Db,
  request: Request,
  input: z.output<typeof setPasswordInput>,
): Promise<{ status: "set" }> {
  authorize(actor, "dashboard.password");
  if (await passwordWasPwned(input.password)) {
    throw new AppError(
      "validation",
      undefined,
      "This password has appeared in a data breach elsewhere. Please choose a different one.",
    );
  }
  const { error } = await authClient(request).updateUser({ password: input.password });
  if (error !== null) {
    if (isAuthRetryableFetchError(error)) throw unavailable();
    // Supabase Auth refuses a weak or reused password with a message meant for the person.
    throw new AppError("validation", undefined, error.message);
  }
  const { error: auditError } = await db.rpc("write_audit", {
    ...auditContext(actor),
    p_action: "dashboard.password",
    p_entity: "user",
    p_entity_id: actor.userId,
    p_before: null,
    p_after: { password: "changed" },
  });
  if (auditError !== null) logLine("warn", "password_audit_failed", { code: auditError.code });
  return { status: "set" };
}

/** Ends the session at Supabase Auth and expires its cookies and `mop_csrf`. */
export async function signOut(actor: AdminActor, request: Request): Promise<Response> {
  authorize(actor, "me");
  const { error } = await authClient(request).signOut();
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

/**
 * The failure of a later grant when an existing account was given roles one call at a time: the roles before it stay,
 * so the answer names them. A failure of the first grant is passed on as it is.
 */
function partialInvite(userId: string, given: readonly string[], failure: unknown): unknown {
  if (given.length === 0) return failure;
  logLine("error", "team_invite_partial", { userId, code: fromRpcError(failure).code, given });
  return new AppError(
    "team_write_failed",
    undefined,
    `The account has these roles already: ${given.join(", ")}. The other roles were not given. Grant them from the team list.`,
  );
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

/**
 * An address that already has an auth user and no `user_roles` row at all is a former client (W6 item 7: asking for a
 * room link makes the user): the roles go to that user, with note `invite`, and no mail is sent (`mailed: false`);
 * they sign in at `/admin/sign-in` like any teammate. A person with any role row, enabled or switched off, keeps the
 * refusal: `grant_role` would start a new role of a switched-off person disabled and cannot repeat a role, so
 * re-enabling is `setUserDisabled`'s path. The user is read by address through `user_id_by_email` (the admin API has
 * no such read, and a generated link would mint a live sign-in token). The account is never deleted when a grant fails:
 * it was not made here, and `grant_role` is safe to repeat. Each role is its own call, so a failure after the first
 * keeps the earlier roles, and the answer names them (`partialInvite`).
 */
async function inviteExisting(
  actor: AdminActor,
  db: Db,
  input: InviteInput,
): Promise<{ user_id: string; mailed: boolean }> {
  const userId = z
    .string()
    .uuid()
    .nullable()
    .parse(await rpcOrThrow(db.rpc("user_id_by_email", { p_email: input.email })));
  if (userId === null) throw teamWriteFailed();
  const held = await db.from("user_roles").select("role").eq("user_id", userId);
  if (held.error !== null) {
    throw new AppError(
      "unavailable",
      undefined,
      "The service is busy. Please try again in a moment.",
    );
  }
  if (held.data.length > 0) {
    throw new AppError("already_exists", undefined, "This address already has an account.");
  }
  const given: string[] = [];
  for (const role of input.roles) {
    await rpcOrThrow(
      db.rpc("grant_role", {
        p_user: userId,
        p_role: role,
        p_note: "invite",
        p_display_name: input.display_name,
        ...auditContext(actor),
      }),
    ).catch((failure: unknown) => {
      throw partialInvite(userId, given, failure);
    });
    given.push(role);
  }
  return { user_id: userId, mailed: false };
}

/**
 * `POST team/users`: Supabase Auth mails the invitation (`mailed: true`); `grant_role` writes each role, with note
 * `invite`. An address that already has an account takes `inviteExisting`'s path, with no mail.
 */
export async function inviteUser(
  actor: AdminActor,
  db: Db,
  input: InviteInput,
): Promise<{ user_id: string; mailed: boolean }> {
  authorize(actor, "team.invite");
  const { data, error } = await db.auth.admin.inviteUserByEmail(input.email);
  if (error !== null) {
    if (isAuthApiError(error) && error.code === "email_exists") {
      return inviteExisting(actor, db, input);
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
  return { user_id: userId, mailed: true };
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
