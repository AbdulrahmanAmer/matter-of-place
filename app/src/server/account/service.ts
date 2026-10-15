import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import type { z } from "zod";
import {
  accountRoomSchema,
  type accountConfirmInput,
  type accountLinkInput,
  type AccountView,
} from "../../domain/account.ts";
import { fromRpcError } from "../lib/admin-errors.ts";
import { sameOrigin } from "../lib/csrf.ts";
import type { Db } from "../lib/db.ts";
import type { env } from "../lib/env.ts";
import { AppError } from "../lib/errors.ts";
import { clientIp, hashKey } from "../lib/ids.ts";
import { logLine } from "../lib/log.ts";
import { checkDb, checkMemory } from "../lib/ratelimit.ts";
import { authClient, getSessionUser } from "../lib/session.ts";
import { verifyTurnstile } from "../lib/turnstile.ts";

// W6 item 7, ruling H113: the client room's sign-in, sign-out and its one read. A client is the signed-in person whose
// confirmed email is a contact's; the room reads only through `account_room`, given the verified session's user.

type WorkerEnv = typeof env;

const ROUTE = "account-send-link";
const HOUR_MS = 3_600_000;
// The staff link's hourly limits (team/service.ts): five tries per address of origin, three per email.
const PER_IP = 5;
const PER_EMAIL = 3;
const SENT = { status: "sent" } as const;

const unavailable = () =>
  new AppError(
    "auth_unavailable",
    undefined,
    "Sign-in is unavailable at the moment. Please try again shortly.",
  );

const foreignOrigin = () =>
  new AppError("csrf", undefined, "Please open this page again and try once more.");

/** Why a link request is refused before the address is looked up, or null when it may go on. */
async function limited(
  db: Db,
  request: Request,
  environment: WorkerEnv,
  input: z.output<typeof accountLinkInput>,
): Promise<string | null> {
  const ip = clientIp(request);
  const bot = await verifyTurnstile(input.turnstile, ip, environment, ROUTE);
  if (bot === "fail") return "turnstile";
  if (bot === "unreachable") logLine("warn", "turnstile_unreachable", { route: ROUTE });
  if (!checkMemory(`${ROUTE}:ip`, ip, PER_IP, HOUR_MS).ok) return "memory";
  const salt = environment.RATE_LIMIT_SALT;
  const [ipHash, emailHash] = await Promise.all([hashKey(salt, ip), hashKey(salt, input.email)]);
  const checked = await checkDb(db, [
    { bucket: `${ROUTE}:ip`, keyHash: ipHash, limit: PER_IP, windowSeconds: 3600 },
    { bucket: `${ROUTE}:email`, keyHash: emailHash, limit: PER_EMAIL, windowSeconds: 3600 },
  ]);
  return checked.ok ? null : "limit";
}

/**
 * Mails a Supabase Auth link to an address that is a contact, making its auth user once (public sign-ups are off).
 * Always answers `sent`: a refusal, an unknown address and a mail failure look the same from outside.
 */
export async function sendAccountLink(
  db: Db,
  request: Request,
  environment: WorkerEnv,
  input: z.output<typeof accountLinkInput>,
): Promise<typeof SENT> {
  if (!sameOrigin(request)) throw foreignOrigin();
  const reason = await limited(db, request, environment, input);
  if (reason !== null) {
    logLine("warn", "send_link_limited", { reason, route: ROUTE });
    return SENT;
  }
  const known = await db.rpc("account_can_sign_in", { p_email: input.email });
  if (known.error !== null) throw fromRpcError(known.error);
  if (!known.data) return SENT;
  // The address is a contact's; the link it receives proves the person holds it before any session exists.
  const created = await db.auth.admin.createUser({ email: input.email, email_confirm: true });
  if (created.error !== null && created.error.code !== "email_exists") {
    logLine("warn", "auth_send_failed", { status: created.error.status ?? 0, route: ROUTE });
    return SENT;
  }
  const { error } = await authClient(request).signInWithOtp({
    email: input.email,
    options: {
      shouldCreateUser: false,
      emailRedirectTo: `${new URL(request.url).origin}/account/confirm`,
    },
  });
  if (error !== null)
    logLine("warn", "auth_send_failed", { status: error.status ?? 0, route: ROUTE });
  return SENT;
}

/** The confirm page's post: spends the token hash and, when it holds, sets the session cookies. */
export async function verifyAccountLink(
  request: Request,
  input: z.output<typeof accountConfirmInput>,
): Promise<{ status: "signed-in" | "expired" }> {
  if (!sameOrigin(request)) throw foreignOrigin();
  const { data, error } = await authClient(request).verifyOtp({
    type: "email",
    token_hash: input.token_hash,
  });
  if (error !== null && isAuthRetryableFetchError(error)) throw unavailable();
  return { status: data.session === null ? "expired" : "signed-in" };
}

/** The room of the signed-in person, the "not found" state when no contact is theirs, or the sign-in form. */
export async function readAccount(db: Db, request: Request): Promise<AccountView> {
  const user = await getSessionUser(request);
  if (user === null) return { state: "signed-out" };
  const { data, error } = await db.rpc("account_room", { p_user: user.userId });
  if (error !== null) throw fromRpcError(error);
  const room = accountRoomSchema.nullable().parse(data);
  return room === null ? { state: "unknown" } : { state: "room", ...room };
}

/** Ends the session at Supabase Auth; the cookies it expires leave with the answer. */
export async function signOutAccount(request: Request): Promise<{ status: "signed-out" }> {
  if (!sameOrigin(request)) throw foreignOrigin();
  const { error } = await authClient(request).signOut();
  if (error !== null && isAuthRetryableFetchError(error)) throw unavailable();
  return { status: "signed-out" };
}
