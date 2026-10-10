import { z } from "zod";
import { adminPageAnswer, adminPageSchema } from "./admin-page.ts";
import { appRoles } from "./contracts.ts";

// Staff sign-in and `GET /api/admin/me` (invariants 2, 11 and 19).

/** `POST /api/admin/auth/send-link`. The Turnstile token travels in the `x-turnstile-token` header. */
export const sendLinkInput = z.object({ email: z.string().trim().toLowerCase().email().max(254) });

/** The form the confirm page posts to `POST /api/admin/auth/verify`. */
export const verifyInput = z.object({
  token_hash: z.string().min(1).max(512),
  type: z.enum(["email", "invite"]),
  next: z.string().max(2048).optional(),
});

/** The body of `GET /api/admin/me`. */
export const meSchema = z.object({
  actor: z.object({ id: z.string() }),
  kind: z.enum(["human", "agent"]),
  roles: z.array(z.enum(appRoles)),
  scopes: z.array(z.string()),
  /** The registered actions this actor may perform, read by `<RoleGate>` and the nav. */
  actions: z.array(z.string()),
  environment: z.enum(["local", "preview", "production"]),
});

// Screen 23 (step 14): users and roles, agent accounts and their keys, revoke all, and the agents' daily caps. Every
// team route is for a person only, with a sign-in in the last 15 minutes (invariants 3 and 11).

const role = z.enum(appRoles);
const userId = z.string().uuid();
const label = z.string().trim().min(1).max(80);

/** The route groups an agent key may cover: every group but `team` and `settings` (invariant 3). */
export const agentScopes = [
  "submissions",
  "properties",
  "media",
  "inquiries",
  "stories",
  "markets",
  "audit",
  "automation",
  "dashboard",
  "payments",
  "newsletter",
  "channels",
  "reports",
  "people",
  "jobs",
  "assets",
] as const;
export type AgentScope = (typeof agentScopes)[number];

const scopes = z
  .array(z.enum(agentScopes))
  .min(1)
  .refine((list) => new Set(list).size === list.length, "Each area once.");

/** `GET team/users`: one keyset page of `team_users`. */
export const teamUsersInputSchema = adminPageSchema.extend({ cursor: userId.optional() });

export const teamUserSchema = z.object({
  user_id: z.string(),
  email: z.string(),
  display_name: z.string().nullable(),
  roles: z.array(role),
  actor_kind: z.enum(["human", "agent"]),
  disabled: z.boolean(),
  last_active_at: z.string().nullable(),
});
export type TeamUser = z.infer<typeof teamUserSchema>;
export const teamUsersPageSchema = adminPageAnswer(teamUserSchema);

/** `POST team/users`: the invitation mail is Supabase Auth's; the roles are written by `grant_role`. */
export const inviteInputSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  display_name: label,
  roles: z
    .array(role)
    .min(1)
    .refine((list) => new Set(list).size === list.length, "Each role once."),
});
export type InviteInput = z.infer<typeof inviteInputSchema>;
export const userCreatedSchema = z.object({ user_id: z.string() });

/** `POST team/users/:id/roles`. */
export const roleGrantInputSchema = z.object({
  id: userId,
  role,
  note: z.string().trim().max(500).optional(),
});

/** `DELETE team/users/:id/roles/:role`. */
export const roleRevokeInputSchema = z.object({ id: userId, role });

/** `POST team/users/:id/disable`; `false` enables the account again. */
export const userDisableInputSchema = z.object({ id: userId, disabled: z.boolean() });
export const userDisabledSchema = z.object({ disabled: z.boolean() });

/** `POST team/agents`: an agent account with one role and its first key. An agent never holds `admin`. */
export const agentCreateInputSchema = z.object({
  label,
  role: z.enum(appRoles).exclude(["admin"]),
  scopes,
});
export type AgentCreateInput = z.infer<typeof agentCreateInputSchema>;

/** `POST team/agents/:id/keys`. */
export const keyCreateInputSchema = z.object({ id: userId, label, scopes });
export type KeyCreateInput = z.infer<typeof keyCreateInputSchema>;

/** The key itself appears in this one answer and nowhere else; only its sha256 is stored. */
export const keyCreatedSchema = z.object({
  user_id: z.string(),
  key_id: z.string(),
  key: z.string(),
});
export type KeyCreated = z.infer<typeof keyCreatedSchema>;

/** `DELETE team/agents/:id/keys/:keyId`. */
export const keyRevokeInputSchema = z.object({ id: userId, keyId: z.string().uuid() });

/** `POST team/agents/revoke-all`: the word typed in the dialog. */
export const revokeAllInputSchema = z.object({ confirm: z.literal("REVOKE") });
export const revokeAllAnswerSchema = z.object({ revoked: z.number().int() });

/** `GET team/agents`: one keyset page of agent keys, never their hash. */
export const agentKeysInputSchema = adminPageSchema.extend({
  cursor: z.string().uuid().optional(),
});
export const agentKeySchema = z.object({
  id: z.string(),
  user_id: z.string(),
  label: z.string(),
  scopes: z.array(z.string()),
  last_used_at: z.string().nullable(),
  revoked_at: z.string().nullable(),
  created_at: z.string(),
});
export type AgentKeyRow = z.infer<typeof agentKeySchema>;
export const agentKeysPageSchema = adminPageAnswer(agentKeySchema);

/** `settings.agent_daily_limits` (SEC-11): a cap of 0 stops that kind of work; requests need at least one. */
export const dailyLimitsSchema = z
  .object({
    decisions_per_day: z.number().int().min(0).max(10_000),
    publish_per_day: z.number().int().min(0).max(10_000),
    requests_per_day: z.number().int().min(1).max(1_000_000),
  })
  .strict();
export type DailyLimits = z.infer<typeof dailyLimitsSchema>;
