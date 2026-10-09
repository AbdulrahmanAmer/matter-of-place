import { z } from "zod";
import {
  agentKeysPageSchema,
  dailyLimitsSchema,
  keyCreatedSchema,
  meSchema,
  revokeAllAnswerSchema,
  teamUsersPageSchema,
  userCreatedSchema,
  userDisabledSchema,
  type AgentCreateInput,
  type AgentScope,
  type DailyLimits,
  type InviteInput,
} from "../../domain/admin-team";
import type { AppRole } from "../../domain/rows";
import { getTurnstileToken } from "../../lib/turnstile";
import { AdminApiError, adminFetch } from "../ui/admin-fetch";

// The browser side of staff sign-in (who is signed in, the request for a sign-in link) and of screen 23. Components
// reach these through `team-queries.ts`.

/** The signed-in actor, or null when the request has no valid session or key (401). */
export async function fetchMe() {
  try {
    return await adminFetch("/api/admin/me", meSchema);
  } catch (error) {
    if (error instanceof AdminApiError && error.status === 401) return null;
    throw error;
  }
}

/** Asks for a sign-in link; the answer is the same whether or not the address belongs to the team. */
export async function requestSignInLink(email: string): Promise<void> {
  const token = await getTurnstileToken("auth-send-link");
  await adminFetch("/api/admin/auth/send-link", z.unknown(), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token === null ? {} : { "x-turnstile-token": token }),
    },
    body: JSON.stringify({ email }),
  });
}

const send = (method: "POST" | "PUT" | "DELETE", body?: unknown) => ({
  method,
  headers: { "content-type": "application/json" },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

const pageQuery = (cursor: string | null) =>
  cursor === null ? "" : `?cursor=${encodeURIComponent(cursor)}`;

const userPath = (id: string) => `/api/admin/team/users/${encodeURIComponent(id)}`;

export function fetchTeamUsers(cursor: string | null) {
  return adminFetch(`/api/admin/team/users${pageQuery(cursor)}`, teamUsersPageSchema);
}

export function fetchAgentKeys(cursor: string | null) {
  return adminFetch(`/api/admin/team/agents${pageQuery(cursor)}`, agentKeysPageSchema);
}

export function fetchDailyLimits() {
  return adminFetch("/api/admin/team/limits", dailyLimitsSchema);
}

export function postInvite(input: InviteInput) {
  return adminFetch("/api/admin/team/users", userCreatedSchema, send("POST", input));
}

export function postRole(id: string, role: AppRole) {
  return adminFetch(`${userPath(id)}/roles`, z.unknown(), send("POST", { role }));
}

export function deleteRole(id: string, role: AppRole) {
  return adminFetch(`${userPath(id)}/roles/${role}`, z.unknown(), send("DELETE"));
}

export function postDisabled(id: string, disabled: boolean) {
  return adminFetch(`${userPath(id)}/disable`, userDisabledSchema, send("POST", { disabled }));
}

export function postAgent(input: AgentCreateInput) {
  return adminFetch("/api/admin/team/agents", keyCreatedSchema, send("POST", input));
}

export function postAgentKey(id: string, label: string, scopes: readonly AgentScope[]) {
  return adminFetch(
    `/api/admin/team/agents/${encodeURIComponent(id)}/keys`,
    keyCreatedSchema,
    send("POST", { label, scopes }),
  );
}

export function deleteAgentKey(id: string, keyId: string) {
  return adminFetch(
    `/api/admin/team/agents/${encodeURIComponent(id)}/keys/${encodeURIComponent(keyId)}`,
    z.unknown(),
    send("DELETE"),
  );
}

export function postRevokeAll() {
  return adminFetch(
    "/api/admin/team/agents/revoke-all",
    revokeAllAnswerSchema,
    send("POST", { confirm: "REVOKE" }),
  );
}

export function putDailyLimits(limits: DailyLimits) {
  return adminFetch("/api/admin/team/limits", dailyLimitsSchema, send("PUT", limits));
}
