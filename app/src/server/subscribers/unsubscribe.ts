import { openUnsubscribeToken, UNSUBSCRIBE_PATH } from "../email/unsubscribe.ts";
import type { Db } from "../lib/db";
import type { env as workerEnv } from "../lib/env";
import { AppError } from "../lib/errors";
import type { PublicCtx } from "../public/routes";
import { unsubscribeCopy, unsubscribePage } from "./unsubscribe-page";

// `/api/public/subscribers/unsubscribe` (OPS-005, RFC 8058): the one-click address that bulk mail sent to one reader
// carries in `List-Unsubscribe`, signed over the subscriber's id. A mail client posts to it. A reader whose client opens
// it in a browser gets the page of the GET, which reads and changes nothing and offers one button that posts the same
// token, so a mail scanner that fetches the link unsubscribes nobody. Every valid post answers the same, whether or not
// the id still names a subscriber who was subscribed: the answer tells nothing about the list.

type Env = typeof workerEnv;

const tokenOf = (request: Request): string | null => new URL(request.url).searchParams.get("t");

/** The signing key, or the refusal every request gets while it is not set. */
function keyOf(env: Env): string {
  const key = env.CONFIRM_TOKEN_SECRET;
  if (key === undefined)
    throw new AppError("unavailable", undefined, "This address is not set up.");
  return key;
}

const unavailable = () =>
  new AppError("unavailable", undefined, "We could not unsubscribe you just now.");

/** POST: unsubscribes the subscriber the token names; the page's own button gets the page, a mail client `{ ok: true }`. */
export async function unsubscribe(request: Request, db: Db, env: Env): Promise<Response> {
  const key = keyOf(env);
  const token = tokenOf(request);
  const id = token === null ? null : await openUnsubscribeToken(token, key);
  if (id === null) throw new AppError("bad_request", undefined, "The address is not valid.");
  const { data, error } = await db.from("subscribers").select("email").eq("id", id);
  if (error !== null) throw unavailable();
  const email = data[0]?.email;
  if (email !== undefined) {
    const written = await db.rpc("unsubscribe_email", { p_email: email });
    if (written.error !== null) throw unavailable();
  }
  return (request.headers.get("accept") ?? "").includes("text/html")
    ? unsubscribePage(unsubscribeCopy.done)
    : Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
}

/** GET: the page with the button, or the page that says the link is not whole. It never touches the database. */
export async function unsubscribeAsk(
  _db: Db,
  query: Record<string, string>,
  ctx: PublicCtx,
): Promise<Response> {
  const key = keyOf(ctx.env);
  const token = query["t"];
  const id = token === undefined ? null : await openUnsubscribeToken(token, key);
  return id === null || token === undefined
    ? unsubscribePage(unsubscribeCopy.invalid, 400)
    : unsubscribePage({ ...unsubscribeCopy.ask, action: `${UNSUBSCRIBE_PATH}?t=${token}` });
}
