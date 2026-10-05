import type { Enums } from "../../db/index.ts";
import { AppError } from "./errors.ts";
import { permissions } from "./permissions/index.ts";

// The authorization matrix of invariant 2: one entry per action, assembled from `permissions/<group>.ts`.
// The server is the check; the UI only hides buttons (tech-stack 5, admin action path).

export type AppRole = Enums<"app_role">;
export type ActorKind = Enums<"actor_kind">;

export interface PermissionEntry {
  readonly action: string;
  /** The route group, which is also the agent scope that covers the action (invariant 3). */
  readonly group: string;
  readonly roles: readonly AppRole[];
  readonly humanOnly?: true;
  /** A sign-in within the last 15 minutes, checked by `defineAdminRoute` (invariant 11). */
  readonly recentAuth?: true;
  /** Not scope-checked: only `me` (invariant 3). */
  readonly scopeFree?: true;
}

/** What `authorize` reads of an actor: its kind, its enabled roles and, for an agent, its key's scopes. */
export interface Principal {
  readonly kind: ActorKind;
  readonly roles: readonly AppRole[];
  readonly scopes: readonly string[];
}

export type ActionId = (typeof permissions)[number]["action"];

/** Exported for `scripts/gen-action-roles.mjs`, the matrix test and the route registry (invariants 2 and 18). */
export const matrix: readonly (PermissionEntry & { readonly action: ActionId })[] = permissions;

const byAction = new Map<string, PermissionEntry>(matrix.map((entry) => [entry.action, entry]));

type Refusal = "forbidden" | "out_of_scope" | "human_only";

const REFUSALS: Record<Refusal, string> = {
  forbidden: "Your account does not allow this action.",
  out_of_scope: "This key does not cover this area.",
  human_only: "Only a person can do this.",
};

/** The 403 of `authorize`, thrown before a service touches the database (SEC-04). */
export class ForbiddenError extends AppError {
  constructor(code: Refusal) {
    super(code, 403, REFUSALS[code]);
    this.name = "ForbiddenError";
  }
}

/** The matrix entry of `action`; an id outside the matrix is refused like a missing role. */
export function permission(action: ActionId): PermissionEntry {
  const entry = byAction.get(action);
  if (entry === undefined) throw new ForbiddenError("forbidden");
  return entry;
}

function refusal(actor: Principal, entry: PermissionEntry): Refusal | null {
  if (actor.kind === "agent") {
    if (entry.humanOnly) return "human_only";
    if (!entry.scopeFree && !actor.scopes.includes(entry.group)) return "out_of_scope";
  }
  return entry.roles.some((role) => actor.roles.includes(role)) ? null : "forbidden";
}

export function can(actor: Principal, action: ActionId): boolean {
  const entry = byAction.get(action);
  return entry !== undefined && refusal(actor, entry) === null;
}

/** Throws `ForbiddenError` unless `actor` may perform `action`; it costs no database call. */
export function authorize(actor: Principal, action: ActionId): void {
  const reason = refusal(actor, permission(action));
  if (reason !== null) throw new ForbiddenError(reason);
}
