import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { z } from "zod";
import {
  accountCreditsSchema,
  type accountPhotosInput,
  type AccountPhotosAnswer,
  accountInvoicesSchema,
  accountPropertiesSchema,
  accountReportsSchema,
  accountRoomSchema,
  type AccountConfirmStatus,
  type accountConfirmInput,
  type accountLinkInput,
  type AccountPage,
  type AccountView,
} from "../../domain/account.ts";
import { enabledRoles } from "../lib/actor.ts";
import { fromRpcError } from "../lib/admin-errors.ts";
import { sameOrigin } from "../lib/csrf.ts";
import type { Db } from "../lib/db.ts";
import type { env } from "../lib/env.ts";
import { AppError } from "../lib/errors.ts";
import { clientIp, hashKey } from "../lib/ids.ts";
import { enqueueJob } from "../lib/jobs.ts";
import { logLine } from "../lib/log.ts";
import { checkDb, checkMemory } from "../lib/ratelimit.ts";
import type { PostgrestError } from "@supabase/supabase-js";
import { authClient, getSessionUser, takeIssuedCookies } from "../lib/session.ts";
import { signUpload } from "../submissions/service.ts";
import { verifyTurnstile } from "../lib/turnstile.ts";
import { carriesWaitUntil, waitUntilOf } from "../lib/wait-until.ts";

// W6 item 7, ruling H119: the client room's sign-in, sign-out and its one read. A client is the signed-in person whose
// confirmed email is a contact's; the room reads only through `account_room`, given the verified session's user.

type WorkerEnv = typeof env;

const ROUTE = "account-send-link";
const HOUR_MS = 3_600_000;
// The staff link's hourly limits (team/service.ts): five tries per address of origin, three per email.
const PER_IP = 5;
const PER_EMAIL = 3;
// Client links of every address together, an hour and a day, well inside the transactional share of the Resend quota
// (75 a day in production), so a run of requests can never use up the mail the requests and invoices need.
const ALL_PER_HOUR = 10;
const ALL_PER_DAY = 40;
const SENT = { status: "sent" } as const;

const unavailable = () =>
  new AppError(
    "auth_unavailable",
    undefined,
    "Sign-in is unavailable at the moment. Please try again shortly.",
  );

const foreignOrigin = () =>
  new AppError("csrf", undefined, "Please open this page again and try once more.");

/** Why a link request is refused before anything is looked up, or null when it may go on. */
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
 * After the answer: an address that is a contact's, inside the global caps, gets a `send_email` job of the template
 * `account_link`, whose step makes the link and mails it through Resend. Nothing here reaches the person.
 */
async function queueLink(db: Db, environment: WorkerEnv, email: string): Promise<void> {
  const known = await db.rpc("account_can_sign_in", { p_email: email });
  if (known.error !== null) throw fromRpcError(known.error);
  if (!known.data) return;
  const all = await hashKey(environment.RATE_LIMIT_SALT, "all");
  const checked = await checkDb(db, [
    { bucket: `${ROUTE}:all`, keyHash: all, limit: ALL_PER_HOUR, windowSeconds: 3600 },
    { bucket: `${ROUTE}:all`, keyHash: all, limit: ALL_PER_DAY, windowSeconds: 86_400 },
  ]);
  if (!checked.ok) {
    logLine("warn", "send_link_limited", { reason: "all", route: ROUTE });
    return;
  }
  await enqueueJob(db, {
    type: "send_email",
    idempotencyKey: `account_link:${crypto.randomUUID()}`,
    params: { template: "account_link" },
    data: { email },
  });
}

/**
 * Queues a sign-in link for an address that is a contact's. Every address takes the same path before the answer,
 * which is always `sent`: the lookup and the mail happen after it (`waitUntil`), so neither the words nor the time of
 * the answer say who is a client.
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
  // Without the Worker's `waitUntil` the lookup and the enqueue run unguarded after the answer and may be cut off: the
  // person is told "sent", nothing is mailed. Say so, so a missing `waitUntil` shows in the logs.
  if (!carriesWaitUntil(request)) logLine("warn", "wait_until_missing", { route: ROUTE });
  waitUntilOf(request)(
    queueLink(db, environment, input.email).catch((error: unknown) => {
      logLine("warn", "auth_send_failed", {
        route: ROUTE,
        error: error instanceof Error ? error.message : "unknown",
      });
    }),
  );
  return SENT;
}

/**
 * The confirm page's post: spends the token hash and, when it holds, sets the session cookies. A person who holds a
 * staff role signs in at `/admin`, where the roles are checked: their session here is ended at once.
 */
export async function verifyAccountLink(
  db: Db,
  request: Request,
  input: z.output<typeof accountConfirmInput>,
): Promise<{ status: AccountConfirmStatus }> {
  if (!sameOrigin(request)) throw foreignOrigin();
  const client = authClient(request);
  const { data, error } = await client.verifyOtp({ type: "email", token_hash: input.token_hash });
  if (error !== null && isAuthRetryableFetchError(error)) throw unavailable();
  if (data.session === null) return { status: "expired" };
  if ((await enabledRoles(db, data.session.user.id)).length > 0) {
    await client.signOut({ scope: "local" });
    // The session is signed out again, so none of its cookies leave the Worker.
    takeIssuedCookies(request);
    return { status: "staff" };
  }
  return { status: "signed-in" };
}

/** The room of the signed-in person, the "not found" state when no contact is theirs, or the sign-in form. */
export const readAccount = (db: Db, request: Request): Promise<AccountView> =>
  readPage(request, accountRoomSchema, (p_user) => db.rpc("account_room", { p_user }));

/**
 * One page of the room (W6 item 8, ruling H142): what `read` answers for the signed-in person, parsed with the page's
 * schema. A function per page, each through `app.contact_of`; the Worker passes the verified session's user, never a
 * browser value. Null from the database is a session with no contact.
 */
async function readPage<T extends z.ZodType<{ name: string; email: string }>>(
  request: Request,
  schema: T,
  read: (userId: string) => PromiseLike<{ data: unknown; error: PostgrestError | null }>,
): Promise<AccountPage<z.output<T>>> {
  const user = await getSessionUser(request);
  if (user === null) return { state: "signed-out" };
  const { data, error } = await read(user.userId);
  if (error !== null) throw fromRpcError(error);
  const page = schema.nullable().parse(data);
  return page === null ? { state: "unknown" } : { state: "room", ...page };
}

/** My properties: each request with the dates of its timeline and the live page once there is one. */
export const readProperties = (db: Db, request: Request) =>
  readPage(request, accountPropertiesSchema, (p_user) => db.rpc("account_properties", { p_user }));

/** Invoices: owed and paid, newest first. */
export const readInvoices = (db: Db, request: Request) =>
  readPage(request, accountInvoicesSchema, (p_user) => db.rpc("account_invoices", { p_user }));

/** Credits: the Five Features balance and the ledger behind it. */
export const readCredits = (db: Db, request: Request) =>
  readPage(request, accountCreditsSchema, (p_user) => db.rpc("account_credits", { p_user }));

/** Reports: campaign results, page views and inquiry counts for the client's properties. */
export const readReports = (db: Db, request: Request) =>
  readPage(request, accountReportsSchema, (p_user) => db.rpc("account_reports", { p_user }));

const addedPhotosSchema = z.array(
  z.object({ media_id: z.string().uuid(), index: z.number().int(), storage_path: z.string() }),
);

/**
 * Photographs added to one of the signed-in person's open requests (W6 item 8, phase 2, ruling H142): the rows are
 * declared by `account_add_photos`, which checks the request is theirs and not yet live, then each file gets a signed
 * URL to put its bytes at; the `reconcile` job settles it once the object is there.
 */
export async function addPhotos(
  db: Db,
  request: Request,
  input: z.output<typeof accountPhotosInput>,
): Promise<AccountPhotosAnswer> {
  if (!sameOrigin(request)) throw foreignOrigin();
  const user = await getSessionUser(request);
  if (user === null) throw new AppError("session_expired", undefined, "Please sign in again.");
  const { data, error } = await db.rpc("account_add_photos", {
    p_user: user.userId,
    p_submission_id: input.submission_id,
    p_media: input.media,
  });
  if (error !== null) throw fromRpcError(error);
  const added = addedPhotosSchema.parse(data);
  return {
    uploads: await Promise.all(
      added.map(async (photo) => ({
        media_id: photo.media_id,
        index: photo.index,
        ...(await signUpload(db, input.submission_id, photo.media_id, photo.storage_path)),
      })),
    ),
  };
}

/**
 * Ends this session at Supabase Auth; the cookies it expires leave with the answer. Only this one: a person who is
 * also on the team keeps their admin sessions on other devices.
 */
export async function signOutAccount(request: Request): Promise<{ status: "signed-out" }> {
  if (!sameOrigin(request)) throw foreignOrigin();
  const { error } = await authClient(request).signOut({ scope: "local" });
  if (error !== null && isAuthRetryableFetchError(error)) throw unavailable();
  return { status: "signed-out" };
}
