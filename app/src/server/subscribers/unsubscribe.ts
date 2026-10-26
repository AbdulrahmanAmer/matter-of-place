import { openUnsubscribeToken } from "../email/unsubscribe.ts";
import type { Db } from "../lib/db";
import type { env as workerEnv } from "../lib/env";
import { AppError } from "../lib/errors";

// `POST /api/public/subscribers/unsubscribe` (OPS-005, RFC 8058): the one-click address that bulk mail sent to one
// reader carries in `List-Unsubscribe`. The signed token names the address; a mail client posts to it, and a link
// fetched by a mail scanner changes nothing because only POST is routed.

export async function unsubscribe(
  request: Request,
  db: Db,
  env: typeof workerEnv,
): Promise<Response> {
  const key = env.CONFIRM_TOKEN_SECRET;
  if (key === undefined) throw new AppError("unavailable", undefined, "This address is not set up.");
  const token = new URL(request.url).searchParams.get("t");
  const address = token === null ? null : await openUnsubscribeToken(token, key);
  if (address === null) throw new AppError("bad_request", undefined, "The address is not valid.");
  const { error } = await db.rpc("unsubscribe_email", { p_email: address });
  if (error !== null) throw new AppError("unavailable", undefined, "We could not unsubscribe you just now.");
  return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
}
